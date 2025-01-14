// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Marketplace} from "./common/Marketplace.sol";
import {IOffer} from "./interfaces/IOffer.sol";

contract Offer is 
    Marketplace,
    IOffer 
{
    enum LotState {
        Created,        // price == 0
        Active,         // price != 0 && block.timestamp < lot.timeout
        Timeout,        // price != 0 && block.timestamp >= lot.timeout
        Sold,           // sold == true
        Closed          // closed == true
    }

    struct Lot {
        IERC721 token;     
        uint64 timeout;
        bool sold;
        bool closed;
        uint256 price;
        uint256 tokenId;
        address creator;
        address buyer;
    }

    uint64 public minDuration;
    mapping (uint256 id => Lot) private _lots;

    modifier onlyCreator(uint256 id) {
        require(_lots[id].creator == _msgSender(), OnlyCreatorAllowed());
        _;
    }

    constructor(
        string memory name,
        uint96 _fee,
        uint64 _minDuration
    ) Marketplace(name, _fee) {
        minDuration = _minDuration;
        emit MinDurationUpdated(0, minDuration);
    }

    /*/////////////////////////////////////////////
    ///////// Read functions             /////////
    ///////////////////////////////////////////*/
    
    // @notice Returns the current state of a specified lot.
    function getLotState(uint256 id) public view returns (LotState) {
        if (_lots[id].sold) {
            return LotState.Sold;
        } else if (_lots[id].closed) {
            return LotState.Closed;
        } else if (_lots[id].price == 0){
            return LotState.Created;
        } else if (_lots[id].price != 0 && _lots[id].timeout > block.timestamp){
            return LotState.Active;
        } else {
            return LotState.Timeout;
        }
    }

    // @notice Returns detailed information about a specific lot.
    function getLotInfo(uint256 id) external view lotExist(id) returns (
        address token,
        LotState state,
        uint64 timeout,
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
            lot.timeout,
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
    function _addOffer(
        IERC721 token,
        uint256 tokenId,
        address creator,
        uint64 duration
    ) private {
        if (duration < minDuration) {
            revert MarketplaceInvalidInputData();
        }

        token.transferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                token: token,
                timeout: uint64(block.timestamp) + duration,                
                sold: false,
                closed: false,
                price: 0,
                tokenId: tokenId,
                creator: creator,
                buyer: creator
        });

        emit OfferAdded(totalLots, address(token), tokenId, _lots[totalLots].timeout, creator);

        totalLots++;
    }

    // @notice Function to add a new lot for a single NFT.
    function addOffer(
        address _token,
        uint256 tokenId,
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
        _addOffer(token, tokenId, creator, duration);
    }

    // @notice Creates multiple lots in a single transaction.
    function addOfferBatch(
        address _token,
        uint256[] calldata tokenIds,
        uint64[] calldata durations
    ) external {
        if (tokenIds.length != durations.length) {
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
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _addOffer(token, tokenIds[i], creator, durations[i]);
        }
    }

    // @notice Approves a lot, transferring the NFT to the buyer and distributing funds.
    function acceptOffer(
        uint256 id
    ) external payable nonReentrant lotExist(id) onlyCreator(id) {
        LotState state = getLotState(id);
        if (!(state == LotState.Active || state == LotState.Timeout)) {
            revert MarketplaceUnexpectedState(
                _encodeState(uint8(LotState.Active)) |
                _encodeState(uint8(LotState.Timeout))
            );
        }

        Lot storage lot = _lots[id];
        lot.sold = true;

        lot.token.transferFrom(address(this), lot.buyer, lot.tokenId);
        
        uint256 price = _calculatePriceWithFeeAndUpdate(address(lot.token), lot.tokenId, lot.price);

        (bool success, ) = lot.creator.call{value: price}("");
        require(success, MarketplaceTransactionFailed());

        emit OfferAccepted(id, lot.buyer, price);
    }

     // @notice Closes a lot and returns the NFT to the creator. 
     // Can be called by creator at any time
     // Can be called by any account only if timeout is over
    function closeOffer(
        uint256 id
    ) external nonReentrant lotExist(id) {
        LotState state = getLotState(id);
        if (!(state == LotState.Created || state == LotState.Active || state == LotState.Timeout)) {
            revert MarketplaceUnexpectedState(
                _encodeState(uint8(LotState.Created)) | 
                _encodeState(uint8(LotState.Active)) |
                _encodeState(uint8(LotState.Timeout))
            );
        }

        address closer = _msgSender();
        Lot storage lot = _lots[id];

        // others accounts can close lot only after timeout is over
        if (closer != lot.creator && state != LotState.Timeout) {
            revert MarketplaceUnexpectedState(_encodeState(uint8(LotState.Timeout)));
        }

        lot.closed = true;
        lot.token.transferFrom(address(this), lot.creator, lot.tokenId);

        if (lot.price > 0) {
            // send ETH back to buyer, no market and royalty fee hold
            (bool success, ) = lot.buyer.call{value: lot.price}("");
            require(success, MarketplaceTransactionFailed());
        }

        emit OfferClosed(id, closer);
    }

    // @notice Places an offer on a lot, updating the price and buyer if the offer is higher.
    // Also sends previuos offerred value back
    function placeOffer(
        uint256 id
    ) external payable nonReentrant lotExist(id)  {
        uint256 value = msg.value;
        if (value <= _lots[id].price) {
            revert InsufficientValue();
        }

        LotState state = getLotState(id);
        if (!(state == LotState.Created || state == LotState.Active)) {
            revert MarketplaceUnexpectedState(
                _encodeState(uint8(LotState.Created)) |
                _encodeState(uint8(LotState.Active))
            );
        }

        Lot storage lot = _lots[id];
        if (lot.price != 0) {
            (bool success, ) = lot.buyer.call{value: lot.price}("");
            require(success, MarketplaceTransactionFailed());
        }

        address offerer = _msgSender();
        lot.price = value;
        lot.buyer = offerer;

        emit OfferPlaced(id, offerer, value);
    }

    /*/////////////////////////////////////////////
    ///////// Update functions            ////////
    ///////////////////////////////////////////*/
    function updateMinDuration(uint64 newMinDuration) external onlyOwner {
        require(newMinDuration != minDuration, MarketplaceInvalidInputData());
        
        emit MinDurationUpdated(minDuration, newMinDuration);

        minDuration = newMinDuration;
    }
}