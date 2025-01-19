// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Marketplace} from "./common/Marketplace.sol";
import {IFixedPrice} from "./interfaces/IFixedPrice.sol";

contract FixedPrice is 
    Marketplace,
    IFixedPrice 
{
    enum LotState {
        Active,     
        Sold,       
        Closed    
    }

    struct Lot {
        IERC721 token;
        LotState state;
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

    constructor(
        uint96 _fee
    ) Marketplace(_fee) {}

    /*/////////////////////////////////////////////
    ///////// Read functions             /////////
    ///////////////////////////////////////////*/

    // @notice Returns the current state of a specified lot.
    function getLotState(uint256 id) public view returns (LotState) {
        return _lots[id].state;
    }

    // @notice Returns detailed information about a specific lot.
    function getLotInfo(uint256 id) external view lotExist(id) returns (
        address token,
        uint8 state,
        uint256 price,
        uint256 tokenId,
        address creator,
        address buyer
    ) 
    {
        Lot memory lot = _lots[id];
        return (
            address(lot.token),
            uint8(lot.state),
            lot.price,
            lot.tokenId,
            lot.creator,
            lot.buyer
        );
    }

    /*/////////////////////////////////////////////
    ///////// Write functions             ////////
    ///////////////////////////////////////////*/

    // @dev Internal function to add a new lot to the marketplace.
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
                state: LotState.Active,
                price: price,
                tokenId: tokenId,
                creator: creator,
                buyer: creator
        });

        emit LotAdded(totalLots, address(token), tokenId, price, creator);

        totalLots++;
    }

    // @notice Function to add a new lot for a single NFT.
    function addLot(
        address _token,
        uint256 tokenId,
        uint256 price
    ) external isInWhitelist(_token) {
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

    // @notice Adds multiple lots for batch NFTs.
    function addLotBatch(
        address _token,
        uint256[] calldata tokenIds,
        uint256[] calldata prices
    ) external isInWhitelist(_token) {
        if (tokenIds.length != prices.length) {
            revert MarketplaceArrayLengthMissmatch();
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

    // @notice Allows a user to buy a lot by paying the exact price.
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
        lot.state = LotState.Sold;
        lot.buyer = buyer;

        lot.token.transferFrom(address(this), buyer, lot.tokenId);
        uint256 price = _calculatePriceWithFeeAndUpdate(address(lot.token), lot.tokenId, value);

        (bool success, ) = lot.creator.call{value: price}("");
        require(success, MarketplaceTransactionFailed());

        emit LotSold(id, buyer, price);
    }

    // @notice Closes an active lot and returns the NFT to the creator.
    function closeLot(
        uint256 id
    ) external lotExist(id) onlyCreator(id) {
        if (getLotState(id) != LotState.Active) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Active)));
        }

        Lot storage lot = _lots[id];
        lot.state = LotState.Closed;
        
        lot.token.transferFrom(address(this), lot.creator, lot.tokenId);

        emit LotClosed(id);
    }
}