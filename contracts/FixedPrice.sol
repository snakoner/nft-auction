// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MarketplaceCommon} from "./MarketplaceCommon.sol";
import {IFixedPrice} from "./interfaces/IFixedPrice.sol";

contract FixedPrice is 
    MarketplaceCommon,
    IFixedPrice 
{
    enum LotState {
        Active,     // sold == false && closed == false
        Sold,       // sold == true
        Closed      // closed == true
    }

    struct Lot {
        IERC721 token;     
        bool sold;
        bool closed;
        uint256 price;
        uint256 tokenId;
        address creator;
        address buyer;
    }

    mapping (uint256 id => Lot) private _lots;

    modifier onlyCreator(uint256 id) {
        require(_lots[id].creator == _msgSender(), OnlyCreatorAllowed());
        _;
    }

    constructor(uint24 _fee) MarketplaceCommon(_fee) {}

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
        address token,
        LotState state,
        uint256 price,
        uint256 tokenId,
        address creator,
        address buyer
    ) 
    {
        Lot memory lot = _lots[id];
        return (
            address(lot.token),
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
    function _addLot(
        IERC721 token,
        uint256 tokenId,
        uint256 price,
        address creator
    ) private {
        require(price > 0, MarketplaceInvalidInputData());

        token.transferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                token: token,
                sold: false,
                closed: false,
                price: price,
                tokenId: tokenId,
                creator: creator,
                buyer: creator
        });

        emit LotAdded(totalLots, address(token), tokenId, price, creator);

        totalLots++;
    }

    function addLot(
        address _token,
        uint256 tokenId,
        uint256 price
    ) external {
        if (price == 0) {
            revert MarketplaceInvalidInputData();
        }

        if (!_supportsERC721Interface(_token)) {
            revert MarketplaceNoIERC721Support();
        }

        address creator = _msgSender();
        if (!_supportsERC721ReceiverInterface(creator)) {
            revert MarketplaceNoIERC721ReceiverSupport();
        }

        IERC721 token = IERC721(_token);
        _addLot(token, tokenId, price, creator);
    }

    function addLotBatch(
        address _token,
        uint256[] calldata tokenIds,
        uint256[] calldata prices
    ) external {
        if (tokenIds.length != prices.length) {
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
        for (uint i = 0; i < tokenIds.length; i++) {
            _addLot(token, tokenIds[i], prices[i], creator);
        }
    }

    function buyLot(
        uint256 id
    ) external payable nonReentrant lotExist(id) {
        if (getLotState(id) != LotState.Active) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        uint256 value = msg.value;
        if (value != _lots[id].price) {
            revert InsufficientValue();
        }

        address buyer = _msgSender();

        Lot storage lot = _lots[id];
        lot.sold = true;
        lot.buyer = buyer;

        lot.token.transferFrom(address(this), buyer, lot.tokenId);
        uint256 price = _calculatePriceWithFeeAndUpdate(address(lot.token), lot.tokenId, value);

        (bool success, ) = lot.creator.call{value: price}("");
        require(success, MarketplaceTransactionFailed());

        emit LotSold(id, buyer, price);
    }

    function closeLot(
        uint256 id
    ) external lotExist(id) onlyCreator(id) {
        if (getLotState(id) != LotState.Active) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        Lot storage lot = _lots[id];
        lot.closed = true;

        lot.token.transferFrom(address(this), lot.creator, lot.tokenId);

        emit LotClosed(id);
    }
}