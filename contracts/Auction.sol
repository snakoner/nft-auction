// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Marketplace} from "./common/Marketplace.sol";
import {IAuction} from "./interfaces/IAuction.sol";

contract Auction is 
    Marketplace,
    IAuction
{
    enum LotState {
        Active,     // timeout < block.timestamp
        Pending,    // timeout >= block.timestamp, wait for completeAuction
        Ended       // withdrawn == true
    }

    struct Lot {
        IERC721 token;      
        uint64 timeout;    
        bool withdrawn;   
        uint256 minBidStep;
        uint256 startPrice;
        uint256 lastPrice;
        uint256 tokenId;
        address winner;
        address creator;
        uint64 extensionTime;       // if bid was done before auction timeout time -> extend timeout
    }

    // @notice uint96 fee (from Marketplace contract)
    uint64 public minDuration;
    uint64 public deadlineForExtensionTime;
    mapping (uint256 id => Lot) private _lots;

    modifier notCreator(uint256 id) {
        require(_lots[id].creator != _msgSender(), NotCreatorAllowedOnly());
        _;
    }

    constructor(
        uint96 _fee,
        uint64 _minDuration,
        uint64 _deadlineForExtensionTime
    ) Marketplace(_fee) {
        updateMinDuration(_minDuration);
        updateDeadlineForExtensionTime(_deadlineForExtensionTime);
    }

    /*/////////////////////////////////////////////
    ///////// Read functions             /////////
    ///////////////////////////////////////////*/

    // @notice Returns the current state of a specified lot.
    function getLotState(uint256 id) public view returns (LotState) {
        if (_lots[id].timeout > uint64(block.timestamp)) {
            return LotState.Active;
        } else if (_lots[id].withdrawn) {
            return LotState.Ended;
        } else {
            return LotState.Pending;
        }
    }

    // @notice Returns detailed information about a specific lot.
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
        Lot storage lot = _lots[id];
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

    function _timeLeft(uint256 id) private view returns (uint64) {
        if (_lots[id].timeout > block.timestamp) return _lots[id].timeout - uint64(block.timestamp);

        return 0;
    }

    /*/////////////////////////////////////////////
    ///////// Write functions            /////////
    ///////////////////////////////////////////*/

    // @dev Internal function to add a new lot to the marketplace.
    function _addLot(
        IERC721 token,
        uint256 tokenId,
        uint256 startPrice,
        uint256 minBidStep,
        uint64 duration,
        uint64 extensionTime,
        address creator
    ) internal {
        require(
            duration >= minDuration && startPrice != 0, 
            MarketplaceInvalidInputData()
        );

        token.safeTransferFrom(creator, address(this), tokenId);

        _lots[totalLots] = Lot({
                token: token,
                timeout: uint64(block.timestamp) + duration,                
                withdrawn: false,
                startPrice: startPrice,
                minBidStep: minBidStep,
                lastPrice: startPrice,
                tokenId: tokenId,
                winner: creator,
                creator: creator,
                extensionTime: extensionTime
        });

        emit LotAdded(
            totalLots,
            address(token),
            tokenId,
            startPrice,
            minBidStep,
            _lots[totalLots].timeout,
            extensionTime,
            creator
        );

        totalLots++;
    }

    // @notice Function to add a new lot for a single NFT.
    function addLot(
        address _token,
        uint256 tokenId,
        uint256 startPrice,
        uint256 minBidStep,
        uint64 duration,
        uint64 extensionTime
    ) external isInWhitelist(_token) {
        require(
            _supportsERC721Interface(_token), 
            MarketplaceNoIERC721Support()
        );

        address creator = _msgSender();
        require(
            _supportsERC721ReceiverInterface(creator), 
            MarketplaceNoIERC721ReceiverSupport()
        );

        IERC721 token = IERC721(_token);
        _addLot(
            token, 
            tokenId, 
            startPrice, 
            minBidStep, 
            duration, 
            extensionTime, 
            creator
        );
    }

    // @notice Creates multiple lots in a single transaction.
    function addLotBatch(
        address _token,
        uint256[] calldata tokenIds,
        uint256[] calldata startPrices,
        uint256[] calldata minBidSteps,
        uint64[] calldata durations,
        uint64[] calldata extensionTimes
    ) external isInWhitelist(_token) {
        require(
            tokenIds.length == startPrices.length && tokenIds.length == durations.length,
            MarketplaceArrayLengthMissmatch()
        );

        require(
            _supportsERC721Interface(_token), 
            MarketplaceNoIERC721Support()
        );

        address creator = _msgSender();
        require(
            _supportsERC721ReceiverInterface(creator), 
            MarketplaceNoIERC721ReceiverSupport()
        );

        IERC721 token = IERC721(_token);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _addLot(
                token, 
                tokenIds[i], 
                startPrices[i], 
                minBidSteps[i], 
                durations[i], 
                extensionTimes[i], 
                creator
            );
        }
    }

    // @notice Places a bid on an active auction lot.
    function placeBid(uint256 id) external payable 
        nonReentrant 
        lotExist(id)
        notCreator(id)
    {
        require(
            getLotState(id) == LotState.Active, 
            MarketplaceUnexpectedState(_encodeState(uint8(LotState.Active)))
        );

        uint256 newBid = msg.value;
        require(
            newBid >= _lots[id].lastPrice + _lots[id].minBidStep,
            InsufficientBidValue()
        );

        address bidder = _msgSender();
        address oldBidder = _lots[id].winner;
        uint256 oldBid = _lots[id].lastPrice;

        if (_lots[id].lastPrice != _lots[id].startPrice) {
            (bool success, ) = oldBidder.call{value: oldBid}("");
            require(success, MarketplaceTransactionFailed());
        }

        _lots[id].lastPrice = newBid;
        _lots[id].winner = bidder;

        // snipper's bid defence
        if (_lots[id].extensionTime > 0 && _timeLeft(id) < deadlineForExtensionTime) {
                _lots[id].timeout += _lots[id].extensionTime;
                emit TimeoutExtended(id, _lots[id].timeout);
        }

        emit BidPlaced(id, bidder, newBid);
    }

    // @notice Completes an auction lot, transferring the NFT to the winner
    // (or back to the creator if no bidders) and distributing funds.
    function completeAuction(uint256 id) external nonReentrant lotExist(id) {
        require(
            getLotState(id) == LotState.Pending, 
            MarketplaceUnexpectedState(_encodeState(uint8(LotState.Pending)))
        );

        uint256 price = 0;
        Lot storage lot = _lots[id];
        lot.withdrawn = true;

        lot.token.safeTransferFrom(address(this), lot.winner, lot.tokenId);

        // if have winner send ETH to creator
        if (lot.startPrice != lot.lastPrice) {
            price = _calculatePriceWithFeeAndUpdate(address(lot.token), lot.tokenId, lot.lastPrice);

            (bool success, ) = lot.creator.call{value: price}("");
            require(success, MarketplaceTransactionFailed());
        }

        emit AuctionCompleted(id, lot.winner, price);
    }

    /*/////////////////////////////////////////////
    ///////// Update functions            ////////
    ///////////////////////////////////////////*/
    function updateMinDuration(uint64 newMinDuration) public onlyOwner {
        require(newMinDuration != minDuration, MarketplaceInvalidInputData());
        
        emit MinDurationUpdated(minDuration, newMinDuration);

        minDuration = newMinDuration;
    }

    function updateDeadlineForExtensionTime(uint64 newTime) public onlyOwner {
        require(newTime != deadlineForExtensionTime, MarketplaceInvalidInputData());
        
        emit DeadlineForExtensionTimeUpdated(deadlineForExtensionTime, newTime);

        deadlineForExtensionTime = newTime;
    }
}