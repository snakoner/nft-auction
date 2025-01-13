// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IMarketplaceCommon } from "./interfaces/IMarketplaceCommon.sol";

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

        try IERC165(contractAddress).supportsInterface(0x80ac58cd) returns (bool result) {
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
    
        try IERC165(sender).supportsInterface(0x150b7a02) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    function _encodeState(uint8 state) internal pure returns (bytes32) {
        return bytes32(1 << uint8(state));
    }

    function _calculatePriceWithFeeAndUpdate(uint256 value) internal returns (uint256) {
        uint256 feeValue = value * fee / 10000;
        _feeValue += feeValue;

        return value - feeValue;
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