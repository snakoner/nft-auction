// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { MarketplaceCommonERC721 } from "./MarketplaceCommonERC721.sol";
import { IAuctionERC721 } from "./interfaces/IAuctionERC721.sol";

contract AuctionERC721 is 
    MarketplaceCommonERC721,
    IAuctionERC721
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

    constructor(uint24 _fee) MarketplaceCommonERC721(_fee) {}

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
            revert ERC721InvalidInputData();
        }

        if (!_supportsERC721Interface(_item)) {
            revert ERC721NoIERC721Support();
        }

        address creator = _msgSender();

        if (!_supportsERC721ReceiverInterface(creator)) {
            revert ERC721NoIERC721ReceiverSupport();
        }

        IERC721 item = IERC721(_item);
        if (item.ownerOf(tokenId) != creator) {
            revert ERC721OwnershipError();
        }

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

    function bidLot(uint256 id) external payable 
        nonReentrant 
        lotExist(id)  
    {
        if (getLotState(id) != LotState.Active) {
            revert ERC721UnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        uint256 newBid = msg.value;
        if (newBid < _lots[id].lastPrice) 
            revert AuctionERC721InsufficientBidValue();

        address bidder = _msgSender();
        address oldBidder = _lots[id].winner;
        uint256 oldBid = _lots[id].lastPrice;

        _lots[id].winner = bidder;
        _lots[id].lastPrice = newBid;

        if (_lots[id].bidsNumber != 0) {
            (bool success, ) = oldBidder.call{value: oldBid}("");
            require(success, ERC721TransactionFailed());
        }

        _lots[id].bidsNumber++;

        emit LotBidded(id, bidder, newBid);
    }

    // this function can be call by anyone
    function endLot(uint256 id) external nonReentrant lotExist(id) {
        if (getLotState(id) != LotState.Pending) {
            revert ERC721UnexpectedState(_encodeState(uint8(LotState.Pending)));
        }

        uint256 price = 0;
        Lot storage lot = _lots[id];
        lot.withdrawed = true;

        lot.item.safeTransferFrom(address(this), lot.winner, lot.tokenId);

        // if have winner send ETH to creator
        if (lot.bidsNumber != 0) {

            price = _calculatePriceWithFeeAndUpdate(lot.lastPrice);

            (bool success, ) = lot.creator.call{value: price}("");
            require(success, ERC721TransactionFailed());
        }

        emit LotEnded(id, lot.winner, price);
    }
}