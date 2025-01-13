// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { MarketplaceCommonERC721 } from "./MarketplaceCommonERC721.sol";
import { IFixedPriceERC721 } from "./interfaces/IFixedPriceERC721.sol";

contract FixedPriceERC721 is 
    MarketplaceCommonERC721,
    IFixedPriceERC721 
{
    enum LotState {
        Active,     // sold == false && closed == false
        Sold,       // sold == true
        Closed      // closed == true
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
        require(_lots[id].creator == msg.sender, FixedPriceERC721OnlyCreatorAllowed());
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
        } else {
            return LotState.Active;
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
        uint256 tokenId,
        uint256 price
    ) external {
        if (price == 0) {
            revert ERC721InvalidInputData();
        }

        if (!_supportsERC721Interface(_item)) {
            revert ERC721NoERC721InterfaceSupport();
        }

        address creator = msg.sender;
        IERC721 item = IERC721(_item);
        if (item.ownerOf(tokenId) != creator) {
            revert ERC721OwnershipError();
        }

        item.safeTransferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                item: item,
                sold: false,
                closed: false,
                price: price,
                tokenId: tokenId,
                creator: creator,
                buyer: creator
        });

        emit LotAdded(totalLots, _item, tokenId, price, creator);

        totalLots++;
    }

    function buyLot(
        uint256 id
    ) external payable nonReentrant lotExist(id) {
        if (getLotState(id) != LotState.Active) {
            revert ERC721UnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        uint256 value = msg.value;
        if (value != _lots[id].price) {
            revert FixedPriceERC721InsufficientValue();
        }

        address buyer = msg.sender;

        Lot storage lot = _lots[id];
        lot.sold = true;
        lot.buyer = buyer;

        lot.item.safeTransferFrom(address(this), buyer, lot.tokenId);
        uint256 feeValue = value * fee / 10000;
        uint256 price = value - feeValue;
        _feeValue += feeValue;

        (bool success, ) = lot.creator.call{value: price}("");
        require(success, ERC721TransactionFailed());

        emit LotSold(id, buyer, price);
    }

    function closeLot(
        uint256 id
    ) external lotExist(id) onlyCreator(id) {
        if (getLotState(id) != LotState.Active) {
            revert ERC721UnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        Lot storage lot = _lots[id];
        lot.closed = true;

        lot.item.safeTransferFrom(address(this), lot.creator, lot.tokenId);

        emit LotClosed(id);
    }
}