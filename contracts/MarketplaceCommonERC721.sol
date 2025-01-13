// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IMarketplaceCommonERC721 } from "./interfaces/IMarketplaceCommonERC721.sol";

abstract contract MarketplaceCommonERC721 is 
    ReentrancyGuard, 
    Ownable, 
    IERC721Receiver, 
    IMarketplaceCommonERC721 
{
    uint256 public totalLots;
    uint256 internal _feeValue;
    uint24 public fee;	// 10^4 -> (0.01% .. 100%)

    constructor(uint24 _fee) Ownable(msg.sender) {
        fee = _fee;

        emit FeeUpdated(0, fee);
    }

    /*/////////////////////////////////////////////
    ///////// Modifiers                   /////////
    ///////////////////////////////////////////*/
    modifier lotExist(uint256 id) {
        require(totalLots > id, ERC721LotNotExist());
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

    function _encodeState(uint8 state) internal pure returns (bytes32) {
        return bytes32(1 << uint8(state));
    }

    function updateFee(uint24 newFee) public virtual onlyOwner {
        require(fee != newFee, ERC721FeeUpdateFailed());

        emit FeeUpdated(fee, newFee);

        fee = newFee;
    }

    function withdrawFee(address to) public virtual nonReentrant onlyOwner {
        require(_feeValue > 0, ERC721ZeroFeeValue());

        emit FeeWithdrawed(to, _feeValue);

        (bool success, ) = to.call{value: _feeValue}("");
        _feeValue = 0;	// use no reentrant 

        require(success, ERC721TransactionFailed());
    }
}