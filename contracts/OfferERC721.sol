// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { MarketplaceCommonERC721 } from "./MarketplaceCommonERC721.sol";
import { IOfferERC721 } from "./interfaces/IOfferERC721.sol";

contract OfferERC721 is 
    MarketplaceCommonERC721,
    IOfferERC721 
{
    enum LotState {
        Created,        // price == 0
        Purchased,      // price != 0
        Sold,           // sold == true
        Closed          // closed == true
    }

    struct Lot {
        IERC721 item;     
        bool sold;
        bool closed;
        uint256 price;
        uint256 tokenId;
        address creator;
        address buyer;
    }

    mapping (uint256 id => Lot) private _lots;

    modifier onlyCreator(uint256 id) {
        require(_lots[id].creator == _msgSender(), OfferERC721OnlyCreatorAllowed());
        _;
    }

    constructor(uint24 _fee) MarketplaceCommonERC721(_fee) {}

    /*/////////////////////////////////////////////
    ///////// Read functions             /////////
    ///////////////////////////////////////////*/
    function getLotState(uint256 id) public view returns (LotState) {
        if (_lots[id].sold) {
            return LotState.Sold;
        } else if (_lots[id].closed) {
            return LotState.Closed;
        } else if (_lots[id].price == 0){
            return LotState.Created;
        } else {
            return LotState.Purchased;
        }
    }

    function getLotInfo(uint256 id) external view lotExist(id) returns (
        address item,
        LotState state,
        uint256 price,
        uint256 tokenId,
        address creator,
        address buyer
    ) 
    {
        Lot memory lot = _lots[id];
        return (
            address(lot.item),
            getLotState(id),
            lot.price,
            lot.tokenId,
            lot.creator,
            lot.buyer
        );
    }

    /*/////////////////////////////////////////////
    ///////// Write functions             ////////
    ///////////////////////////////////////////*/
    function addLot(
        address _item,
        uint256 tokenId
    ) external {
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
                sold: false,
                closed: false,
                price: 0,
                tokenId: tokenId,
                creator: creator,
                buyer: creator
        });

        emit LotAdded(totalLots, _item, tokenId, creator);

        totalLots++;
    }

    function approveLot(
        uint256 id
    ) external payable nonReentrant lotExist(id) onlyCreator(id) {
        if (getLotState(id) != LotState.Purchased) {
            revert ERC721UnexpectedState(_encodeState(uint8(LotState.Purchased)));
        }

        Lot storage lot = _lots[id];
        lot.sold = true;

        lot.item.safeTransferFrom(address(this), lot.buyer, lot.tokenId);
        
        uint256 price = _calculatePriceWithFeeAndUpdate(lot.price);

        (bool success, ) = lot.creator.call{value: price}("");
        require(success, ERC721TransactionFailed());

        emit LotApproved(id, lot.buyer, price);
    }

    function closeLot(
        uint256 id
    ) external lotExist(id) onlyCreator(id) {
        LotState state = getLotState(id);
        if (!(state == LotState.Created || state == LotState.Purchased)) {
            revert ERC721UnexpectedState(
                _encodeState(uint8(LotState.Created)) | 
                _encodeState(uint8(LotState.Purchased))
            );
        }

        Lot storage lot = _lots[id];
        lot.closed = true;

        lot.item.safeTransferFrom(address(this), lot.creator, lot.tokenId);

        emit LotClosed(id);
    }

    function offerLot(
        uint256 id
    ) external payable nonReentrant lotExist(id)  {
        uint256 value = msg.value;
        if (value <= _lots[id].price) {
            revert OfferERC721InsufficientValue();
        }

        LotState state = getLotState(id);
        if (!(state == LotState.Created || state == LotState.Purchased)) {
            revert ERC721UnexpectedState(
                _encodeState(uint8(LotState.Created)) |
                _encodeState(uint8(LotState.Purchased))
            );
        }

        Lot storage lot = _lots[id];
        if (lot.price != 0) {
            (bool success, ) = lot.buyer.call{value: lot.price}("");
            require(success, ERC721TransactionFailed());
        }

        address offerer = _msgSender();
        lot.price = value;
        lot.buyer = offerer;

        emit LotOffered(id, offerer, value);
    }
}