// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IMarketplaceCommon} from "./interfaces/IMarketplaceCommon.sol";

abstract contract MarketplaceCommon is 
    ReentrancyGuard, 
    Ownable, 
    IERC721Receiver, 
    IMarketplaceCommon
{
    uint256 public totalLots;
    uint256 internal _feeValue;
    uint24 public fee;	// 10^4 -> (0.01% .. 100%)
    uint24 public constant PRECISION = 10000;

    constructor(uint24 _fee) Ownable(msg.sender) {
        require(_fee <= PRECISION, MarketplaceInvalidInputData());
        fee = _fee;

        emit FeeUpdated(0, _fee);
    }

    /*/////////////////////////////////////////////
    ///////// Modifiers                   /////////
    ///////////////////////////////////////////*/
    modifier lotExist(uint256 id) {
        require(totalLots > id, MarketplaceLotNotExist());
        _;
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) public returns (bytes4) {
        emit TokenReceived(operator, from, tokenId, data);

        return this.onERC721Received.selector;
    }

    function _supportsERC721Interface(address contractAddress) internal view returns (bool) {
        uint256 codeLength;

        assembly {
            codeLength := extcodesize(contractAddress)
        }

        if (codeLength == 0) {
            return false;
        }

        try IERC165(contractAddress).supportsInterface(type(IERC721).interfaceId) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    function _supportsERC721ReceiverInterface(address sender) internal view returns (bool) {
        uint256 codeLength;

        assembly {
            codeLength := extcodesize(sender)
        }

        // this is account
        if (codeLength == 0) {
            return true;
        }

        // 0x150b7a02
        try IERC165(sender).supportsInterface(type(IERC721Receiver).interfaceId) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    function royaltyInfo(
        address token,
        uint256 tokenId,
        uint256 salePrice
    ) public view returns (address receiver, uint256 amount) {
        (receiver, amount) = 
            IERC721(token).supportsInterface(type(IERC2981).interfaceId) ? 
            IERC2981(token).royaltyInfo(tokenId, salePrice) :
            (address(0), 0);

        return (receiver, amount);
    }

    function _encodeState(uint8 state) internal pure returns (bytes32) {
        return bytes32(1 << uint8(state));
    }

    // @notice don't use noReentrant because this func is called in noReentrant function
    function _calculatePriceWithFeeAndUpdate(
        address token,
        uint256 tokenId,
        uint256 salePrice
    ) internal returns (uint256) {
        (address receiver, uint256 royaltyFee) = royaltyInfo(token, tokenId, salePrice);
        if (royaltyFee != 0) {
            salePrice -= royaltyFee;
            (bool success, ) = receiver.call{value: royaltyFee}("");
            require(success, MarketplaceTransactionFailed());
        }

        uint256 feeValue = salePrice * fee / 10000;
        _feeValue += feeValue;

        return salePrice - feeValue;
    }

    function updateFee(uint24 newFee) public virtual onlyOwner {
        require(fee != newFee, MarketplaceFeeUpdateFailed());

        emit FeeUpdated(fee, newFee);

        fee = newFee;
    }

    function withdrawFee(address to) public virtual nonReentrant onlyOwner {
        require(_feeValue > 0, MarketplaceZeroFeeValue());

        emit FeeWithdrawed(to, _feeValue);

        (bool success, ) = to.call{value: _feeValue}("");
        _feeValue = 0;	// use no reentrant 

        require(success, MarketplaceTransactionFailed());
    }
}