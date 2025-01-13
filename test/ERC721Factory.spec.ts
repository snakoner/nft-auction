import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import { ERC721Factory } from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";

const {abi: ERC721Abi} = require("../artifacts/@openzeppelin/contracts/token/ERC721/ERC721.sol/ERC721.json");

let factory: ERC721Factory;
let owner: HardhatEthersSigner;

const init = async() => {
    owner = (await ethers.getSigners())[0];
    const accounts = (await ethers.getSigners()).slice(1,);
    
    // nft
    const nftFactory = await ethers.getContractFactory("ERC721Factory");
    factory = await nftFactory.deploy();
    await factory.waitForDeployment();
}

describe("ERC721Factory test", function() {
    beforeEach(async function() {
        await init();
    });

    it ("Should be possible to create ERC721", async function() {
        const tokenName = "My Collection";
        const tokenSymbol = "MC";
        const baseUri = "ipfs://QmbWqxBEKC3P8tqsKc98xmjnA4GZB1zUJx8ofYfN1E4YBz/";

        await factory.createNewToken(tokenName, tokenSymbol, baseUri);
        
        // get nft address
        const events = await factory.queryFilter(factory.filters.TokenCreated(), 0, "latest");
        expect(events[0].args.creator).to.be.eq(await owner.getAddress());
        const nftAddress = events[0].args.token;

        const nftNumber = await factory.accountDeploymentNumber(await owner.getAddress());
        const nftDeployments = await factory.getAccountDeployments(await owner.getAddress());
        const nftDeployment = await factory.getAccountDeployment(await owner.getAddress(), Number(nftNumber) - 1);

        const erc721Contract = new ethers.Contract(nftAddress, ERC721Abi, ethers.provider);

        expect(nftNumber).to.be.eq(1);
        expect(nftDeployments[0]).to.be.eq(nftAddress);
        expect(nftDeployment).to.be.eq(nftAddress);
        expect(await erc721Contract.ownerOf(0)).to.be.eq(await owner.getAddress());
    });
})