// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { MarketplaceCommon } from "./MarketplaceCommon.sol";
import { IAuction } from "./interfaces/IAuction.sol";

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
        IERC721 item;       // slot 0
        uint64 timeout;     // slot 0
        bool withdrawed;    // slot 0
        uint256 bidsNumber;
        uint256 startPrice;
        uint256 lastPrice;
        uint256 tokenId;
        address winner;
        address creator;
    }

    uint64 constant public MIN_DURATION = 1 days;
    mapping (uint256 id => Lot) private _lots;

    constructor(uint24 _fee) MarketplaceCommon(_fee) {}

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
        address item,
        uint64 timeout,
        LotState state,
        uint256 bidsNumber,
        uint256 startPrice,
        uint256 lastPrice,
        uint256 tokenId,
        address winner,
        address creator
    ) {
        Lot memory lot = _lots[id];
        return (
            address(lot.item),
            lot.timeout,
            getLotState(id),
            lot.bidsNumber,
            lot.startPrice,
            lot.lastPrice,
            lot.tokenId,
            lot.winner,
            lot.creator
        );
    }

    /*/////////////////////////////////////////////
    ///////// Write functions            /////////
    ///////////////////////////////////////////*/
    function addLot(
        address _item,
        uint256 tokenId,
        uint256 startPrice,
        uint64 duration
    ) external {
        if (duration < MIN_DURATION || startPrice == 0) {
            revert MarketplaceInvalidInputData();
        }

        if (!_supportsERC721Interface(_item)) {
            revert MarketplaceNoIERC721Support();
        }

        address creator = _msgSender();
        if (!_supportsERC721ReceiverInterface(creator)) {
            revert MarketplaceNoIERC721ReceiverSupport();
        }

        IERC721 item = IERC721(_item);

        item.safeTransferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                item: item,
                timeout: uint64(block.timestamp) + duration,                
                withdrawed: false,
                startPrice: startPrice,
                bidsNumber: 0,
                lastPrice: startPrice,
                tokenId: tokenId,
                winner: creator,
                creator: creator
        });

        emit LotAdded(totalLots, _item, tokenId, startPrice, _lots[totalLots].timeout, creator);

        totalLots++;
    }

    /*/////////////////////////////////////////////
    ///////// Write functions            /////////
    ///////////////////////////////////////////*/
    function addLotBatch(
        address _item,
        uint256[] calldata tokenIds,
        uint256[] calldata startPrices,
        uint64[] calldata durations
    ) external {
        if (tokenIds.length != startPrices.length || tokenIds.length != durations.length) {
            revert ArrayLengthMissmatch();
        }

        if (!_supportsERC721Interface(_item)) {
            revert MarketplaceNoIERC721Support();
        }

        address creator = _msgSender();
        if (!_supportsERC721ReceiverInterface(creator)) {
            revert MarketplaceNoIERC721ReceiverSupport();
        }

        IERC721 item = IERC721(_item);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (durations[i] < MIN_DURATION || startPrices[i] == 0) {
                revert MarketplaceInvalidInputData();
            }

            item.safeTransferFrom(creator, address(this), tokenIds[i]);

            _lots[totalLots] = Lot({
                    item: item,
                    timeout: uint64(block.timestamp) + durations[i],                
                    withdrawed: false,
                    startPrice: startPrices[i],
                    bidsNumber: 0,
                    lastPrice: startPrices[i],
                    tokenId: tokenIds[i],
                    winner: creator,
                    creator: creator
            });

            emit LotAdded(totalLots, _item, tokenIds[i], startPrices[i], _lots[totalLots].timeout, creator);

            totalLots++;
        }
    }

    function bidLot(uint256 id) external payable 
        nonReentrant 
        lotExist(id)  
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

        _lots[id].winner = bidder;
        _lots[id].lastPrice = newBid;

        if (_lots[id].bidsNumber != 0) {
            (bool success, ) = oldBidder.call{value: oldBid}("");
            require(success, MarketplaceTransactionFailed());
        }

        _lots[id].bidsNumber++;

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

        lot.item.safeTransferFrom(address(this), lot.winner, lot.tokenId);

        // if have winner send ETH to creator
        if (lot.bidsNumber != 0) {

            price = _calculatePriceWithFeeAndUpdate(lot.lastPrice);

            (bool success, ) = lot.creator.call{value: price}("");
            require(success, MarketplaceTransactionFailed());
        }

        emit LotEnded(id, lot.winner, price);
    }
}