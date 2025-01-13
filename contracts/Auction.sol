// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MarketplaceCommon} from "./MarketplaceCommon.sol";
import {IAuction} from "./interfaces/IAuction.sol";

contract Auction is 
    MarketplaceCommon,
    IAuction
{
    enum LotState {
        Active,     // timeout < block.timestamp
        Pending,    // timeout >= block.timestamp
        Ended       // withdrawed == true
    }

    struct Lot {
        IERC721 token;       // slot 0
        uint64 timeout;     // slot 0
        bool withdrawed;    // slot 0
        uint256 startPrice;
        uint256 lastPrice;
        uint256 tokenId;
        address winner;
        address creator;
    }

    mapping (uint256 id => Lot) private _lots;

    constructor(uint24 _fee) MarketplaceCommon(_fee) {}

    modifier notCreator(uint256 id) {
        require(_lots[id].creator != _msgSender(), CreatorBidForbidden());
        _;
    }

    /*/////////////////////////////////////////////
    ///////// Read functions             /////////
    ///////////////////////////////////////////*/
    function getLotState(uint256 id) public view returns (LotState) {
        if (_lots[id].timeout > uint64(block.timestamp)) {
            return LotState.Active;
        } else if (_lots[id].withdrawed) {
            return LotState.Ended;
        } else {
            return LotState.Pending;
        }
    }

    function getLotInfo(uint256 id) external view lotExist(id) returns (
        address token,
        uint64 timeout,
        LotState state,
        uint256 startPrice,
        uint256 lastPrice,
        uint256 tokenId,
        address winner,
        address creator
    ) {
        Lot memory lot = _lots[id];
        return (
            address(lot.token),
            lot.timeout,
            getLotState(id),
            lot.startPrice,
            lot.lastPrice,
            lot.tokenId,
            lot.winner,
            lot.creator
        );
    }

    function _minDuration() internal virtual pure returns (uint64) {
        return uint64(1 days);
    }

    /*/////////////////////////////////////////////
    ///////// Write functions            /////////
    ///////////////////////////////////////////*/
    function _addLot(
        IERC721 token,
        uint256 tokenId,
        uint256 startPrice,
        uint64 duration,
        address creator
    ) private {
        if (duration < _minDuration() || startPrice == 0) {
            revert MarketplaceInvalidInputData();
        }

        token.transferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                token: token,
                timeout: uint64(block.timestamp) + duration,                
                withdrawed: false,
                startPrice: startPrice,
                // bidsNumber: 0,
                lastPrice: startPrice,
                tokenId: tokenId,
                winner: creator,
                creator: creator
        });

        emit LotAdded(totalLots, address(token), tokenId, startPrice, _lots[totalLots].timeout, creator);

        totalLots++;
    }

    function addLot(
        address _token,
        uint256 tokenId,
        uint256 startPrice,
        uint64 duration
    ) external {
        if (!_supportsERC721Interface(_token)) {
            revert MarketplaceNoIERC721Support();
        }

        address creator = _msgSender();
        if (!_supportsERC721ReceiverInterface(creator)) {
            revert MarketplaceNoIERC721ReceiverSupport();
        }

        IERC721 token = IERC721(_token);
        _addLot(token, tokenId, startPrice, duration, creator);
    }

    function addLotBatch(
        address _token,
        uint256[] calldata tokenIds,
        uint256[] calldata startPrices,
        uint64[] calldata durations
    ) external {
        if (tokenIds.length != startPrices.length || tokenIds.length != durations.length) {
            revert ArrayLengthMissmatch();
        }

        if (!_supportsERC721Interface(_token)) {
            revert MarketplaceNoIERC721Support();
        }

        address creator = _msgSender();
        if (!_supportsERC721ReceiverInterface(creator)) {
            revert MarketplaceNoIERC721ReceiverSupport();
        }

        IERC721 token = IERC721(_token);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _addLot(token, tokenIds[i], startPrices[i], durations[i], creator);
        }
    }

    function bidLot(uint256 id) external payable 
        nonReentrant 
        lotExist(id)
        notCreator(id)
    {
        if (getLotState(id) != LotState.Active) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        uint256 newBid = msg.value;
        if (newBid < _lots[id].lastPrice) 
            revert InsufficientBidValue();

        address bidder = _msgSender();
        address oldBidder = _lots[id].winner;
        uint256 oldBid = _lots[id].lastPrice;

        if (_lots[id].lastPrice != _lots[id].startPrice) {
            (bool success, ) = oldBidder.call{value: oldBid}("");
            require(success, MarketplaceTransactionFailed());
        }

        _lots[id].lastPrice = newBid;
        _lots[id].winner = bidder;

        emit LotBidded(id, bidder, newBid);
    }

    // this function can be call by anyone
    function endLot(uint256 id) external nonReentrant lotExist(id) {
        if (getLotState(id) != LotState.Pending) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Pending)));
        }

        uint256 price = 0;
        Lot storage lot = _lots[id];
        lot.withdrawed = true;

        lot.token.transferFrom(address(this), lot.winner, lot.tokenId);

        // if have winner send ETH to creator
        if (_lots[id].startPrice != _lots[id].lastPrice) {
            price = _calculatePriceWithFeeAndUpdate(address(lot.token), lot.tokenId, lot.lastPrice);

            (bool success, ) = lot.creator.call{value: price}("");
            require(success, MarketplaceTransactionFailed());
        }

        emit LotEnded(id, lot.winner, price);
    }
}