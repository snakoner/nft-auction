// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721, IERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ERC165, IERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ERC721Token is ERC721, ERC2981, Ownable {
    uint256 public tokenCounter;
    string private _baseUri;

    constructor(
        address owner,
        string memory name,
        string memory symbol,
        string memory baseUri) 
    ERC721(name, symbol) 
    Ownable(owner) {
        _baseUri = baseUri;
    }

    function mint(address to, uint96 feeNumerator) external onlyOwner {
        _mint(to, tokenCounter);
        _setTokenRoyalty(tokenCounter, owner(), feeNumerator);

        tokenCounter++;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseUri;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC2981, ERC721) returns (bool) {
        return interfaceId == type(IERC721).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract ERC721Factory is Ownable {
    event TokenCreated(
        address indexed creator, 
        address indexed token    
    );

    mapping (address account => address[] tokens) private _tokens;

    constructor() Ownable(_msgSender()) {}

    function createNewToken(
        string calldata name,
        string calldata symbol,
        string calldata baseUri
        // uint96 feeNumerator
    ) external returns (address) {
        address account = _msgSender();
        address newToken = address(new ERC721Token(
            account,
            name,
            symbol,
            baseUri)); // create1

        _tokens[account].push(newToken);

        emit TokenCreated(account, newToken);

        return newToken;
    }

    function accountDeploymentNumber(address account) public view returns (uint256) {
        return _tokens[account].length;
    }

    function getAccountDeployments(address account) external view returns (address[] memory) {
        return _tokens[account];
    }

    function getAccountDeployment(address account, uint256 number) external view returns (address) {
        if (accountDeploymentNumber(account) <= number) {
            return address(0);
        }

        return _tokens[account][number];
    }
}