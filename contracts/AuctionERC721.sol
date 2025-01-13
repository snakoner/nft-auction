// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAuctionERC721 } from "./interfaces/IAuctionERC721.sol";

contract AuctionERC721 is 
    Ownable,
    ReentrancyGuard, 
    IERC721Receiver,
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

    uint256 public totalLots;
    uint256 private _feeValue;
    mapping (uint256 id => Lot) private _lots;
    uint64 constant public MIN_DURATION = 1 days;
    uint24 public fee;	// 10^4 -> (0.01% .. 100%)

    /*/////////////////////////////////////////////
    ///////// Modifiers                   /////////
    ///////////////////////////////////////////*/
    modifier lotExist(uint256 id) {
        require(totalLots > id, AuctionERC721LotNotExist());
        _;
    }

    constructor(uint24 _fee) Ownable(msg.sender) {
        fee = _fee;

        emit FeeUpdated(0, fee);
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

    function _encodeState(LotState state) private pure returns (bytes32) {
        return bytes32(1 << uint8(state));
    }

    function _supportsERC721Interface(address contractAddress) private view returns (bool) {
        uint256 codeLength;

        assembly {
            codeLength := extcodesize(contractAddress)
        }

        if (codeLength == 0) {
            return false;
        }

        try IERC165(contractAddress).supportsInterface(0x80ac58cd) returns (bool result) {
            return result;
        } catch {
            return false;
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
            revert AuctionERC721InvalidInputData();
        }

        if (!_supportsERC721Interface(_item)) {
            revert AuctionERC721NoERC721InterfaceSupport();
        }

        address creator = msg.sender;
        IERC721 item = IERC721(_item);
        if (item.ownerOf(tokenId) != creator) {
            revert AuctionERC721OwnershipError();
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
            revert AuctionERC721UnexpectedState(_encodeState(LotState.Active));
        }

        uint256 newBid = msg.value;
        if (newBid < _lots[id].lastPrice) 
            revert AuctionERC721InsufficientBidValue();

        address bidder = msg.sender;
        address oldBidder = _lots[id].winner;
        uint256 oldBid = _lots[id].lastPrice;

        _lots[id].winner = bidder;
        _lots[id].lastPrice = newBid;

        if (_lots[id].bidsNumber != 0) {
            (bool success, ) = oldBidder.call{value: oldBid}("");
            require(success, AuctionERC721TransactionFailed());
        }

        _lots[id].bidsNumber++;

        emit LotBidded(id, bidder, newBid);
    }

    // this function can be call by anyone
    function endLot(uint256 id) external nonReentrant lotExist(id) {
        if (getLotState(id) != LotState.Pending) {
            revert AuctionERC721UnexpectedState(_encodeState(LotState.Pending));
        }

        uint256 price = 0;
        Lot storage lot = _lots[id];
        lot.withdrawed = true;

        lot.item.safeTransferFrom(address(this), lot.winner, lot.tokenId);

        // if have winner send ETH to creator
        if (lot.bidsNumber != 0) {
            uint256 feeValue = lot.lastPrice * fee / 10000;
            price = lot.lastPrice - feeValue;
            _feeValue += feeValue;

            (bool success, ) = lot.creator.call{value: price}("");
            require(success, AuctionERC721TransactionFailed());
        }

        emit LotEnded(id, lot.winner, price);
    }

    function updateFee(uint24 newFee) external onlyOwner {
        require(fee != newFee, AuctionERC721FeeUpdateFailed());

        emit FeeUpdated(fee, newFee);

        fee = newFee;
    }

    function withdrawFee(address to) external nonReentrant onlyOwner {
        require(_feeValue > 0, AuctionERC721ZeroFeeValue());

        emit FeeWithdrawed(to, _feeValue);

        (bool success, ) = to.call{value: _feeValue}("");
        _feeValue = 0;	// use no reentrant 

        require(success, AuctionERC721TransactionFailed());
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4) {
        emit TokenReceived(operator, from, tokenId, data);

        return this.onERC721Received.selector;
    }
}