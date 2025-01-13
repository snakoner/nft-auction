// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ERC721Token is ERC721, Ownable {
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

    function mint(address to) external onlyOwner {
        _mint(to, tokenCounter);

        tokenCounter++;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseUri;
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
    ) external returns (address) {
        address account = _msgSender();
        address newToken = address(new ERC721Token(
            address(this),
            name,
            symbol,
            baseUri)); // create1

        ERC721Token _token = ERC721Token(newToken);
        _token.mint(account);
        _token.transferOwnership(account);

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