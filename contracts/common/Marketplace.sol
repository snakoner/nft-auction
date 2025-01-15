// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IMarketplace} from "../interfaces/IMarketplace.sol";

abstract contract Marketplace is 
    ReentrancyGuard, 
    Ownable, 
    IERC721Receiver, 
    IMarketplace
{
    string public name;
    uint256 public totalLots;
    uint256 internal _feeCollected;
    uint96 public fee;	// [0..._feeDenominator()]

    constructor(string memory _name, uint96 _fee) Ownable(msg.sender) {
        require(_fee <= _feeDenominator(), MarketplaceInvalidInputData());
        name = _name;
        fee = _fee;

        emit FeeUpdated(0, _fee);
    }

    modifier lotExist(uint256 id) {
        require(totalLots > id, MarketplaceLotNotExist());
        _;
    }

    /*/////////////////////////////////////////////
    ///////// Interface support          /////////
    ///////////////////////////////////////////*/

    // @notice Handles receipt of an ERC721 token.
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) public returns (bytes4) {
        emit TokenReceived(operator, from, tokenId, data);

        return this.onERC721Received.selector;
    }

    // @notice Checks if a contract supports the ERC721 interface.
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

    // @notice Checks if the sender is capable of receiving ERC721 tokens.
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

    /*/////////////////////////////////////////////
    ///////// Fee support                /////////
    ///////////////////////////////////////////*/

    // @notice Retrieves royalty information for a token based on ERC2981.
    function royaltyInfo(
        address token,
        uint256 tokenId,
        uint256 salePrice
    ) public view returns (address receiver, uint256 amount) {
        (receiver, amount) = 
            IERC721(token).supportsInterface(type(IERC2981).interfaceId) ? 
            IERC2981(token).royaltyInfo(tokenId, salePrice) :
            (address(0), 0);
    }

    function _encodeState(uint8 state) internal pure returns (bytes32) {
        return bytes32(1 << state);
    }

    // @notice Calculates the price with the fee, sends royalty to token creator and updates the fee storage.
    // don't use noReentrant because this func is called in noReentrant function
    function _calculatePriceWithFeeAndUpdate(
        address token,
        uint256 tokenId,
        uint256 salePrice
    ) internal returns (uint256) {
        (address receiver, uint256 royaltyFee) = royaltyInfo(token, tokenId, salePrice);
        if (royaltyFee != 0) {
            unchecked {
                salePrice -= royaltyFee;
            }

            (bool success, ) = receiver.call{value: royaltyFee}("");
            require(success, MarketplaceTransactionFailed());
        }

        // update marketplace fee value
        uint256 feeValue = salePrice * fee / 10000;
        _feeCollected += feeValue;

        return salePrice - feeValue;
    }

    function _feeDenominator() internal pure virtual returns (uint96) {
        return 10000;
    }

    function getFeeDenominator() public pure returns (uint96) {
        return _feeDenominator();
    }

    function getFeeCollected() public view returns (uint256) {
        return _feeCollected;
    }

    function updateFee(uint96 newFee) external onlyOwner {
        require(fee != newFee, MarketplaceFeeUpdateFailed());

        emit FeeUpdated(fee, newFee);

        fee = newFee;
    }

    function withdrawFee(address to) external nonReentrant onlyOwner {
        require(_feeCollected > 0, MarketplaceZeroFeeValue());

        emit FeeWithdrawed(to, _feeCollected);

        (bool success, ) = to.call{value: _feeCollected}("");
        _feeCollected = 0;	// use no reentrant 

        require(success, MarketplaceTransactionFailed());
    }
}