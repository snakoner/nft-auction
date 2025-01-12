// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract NFT is ERC721 {
    uint256 public tokenIdCounter;

    constructor() ERC721("Example NFT", "ENFT") {}

    function mint() external {
        _mint(msg.sender, tokenIdCounter);
        tokenIdCounter++;
    }
}