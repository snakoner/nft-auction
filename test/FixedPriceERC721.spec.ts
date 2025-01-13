import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {FixedPrice, NFT} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { getTransactionFee } from "./common";

const batchSize = 20;
const tokenId = 0;
const fee = BigInt(20);  // 0.2%

let market: FixedPrice;
let nft: NFT;
let owner: HardhatEthersSigner;
let buyer: HardhatEthersSigner;
let lotInfo = {
    item: ethers.ZeroAddress,
    tokenId: tokenId,
    price: ethers.parseEther("0.1"),
};

/* helpers */
const getLotAddedEvents = async(market: FixedPrice) => {
    let events = await market.queryFilter(market.filters.LotAdded(), 0, "latest");
    if (events.length == 0)
        return null;
    let result: any[] = [];
    for (let i = 0; i < events.length; i++) {
        result.push(
            {
                id: events[i].args?.id,
                item: events[i].args?.item,
                tokenId: events[i].args?.tokenId,
                price: events[i].args?.price,
                creator: events[i].args?.creator
            }
        );
    }

    return result;
}

const getLotSoldEvent = async(market: FixedPrice) => {
    let events = await market.queryFilter(market.filters.LotSold(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        buyer: events[0].args?.buyer,
        price: events[0].args?.price,
    };
}

const getLotClosedEvent = async(market: FixedPrice) => {
    let events = await market.queryFilter(market.filters.LotClosed(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
    };
}

const addLot = async(market: FixedPrice, nft: NFT) => {
    await market.addLot(
        lotInfo.item,
        lotInfo.tokenId,
        lotInfo.price,
    );

    return lotInfo;
}

const init = async() => {
    owner = (await ethers.getSigners())[0];
    buyer = (await ethers.getSigners())[1];
    
    // nft
    const nftFactory = await ethers.getContractFactory("NFT");
    nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    
    lotInfo.item = await nft.getAddress();

    // auction
    const marketFactory = await ethers.getContractFactory("FixedPrice");
    market = await marketFactory.deploy(fee);
    await market.waitForDeployment();

    // mint and approve NFT
    for (let i = 0; i < batchSize; i++) {
        await nft.mint();
        await nft.approve(await market.getAddress(), i);    
    }

    expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
    await nft.approve(await market.getAddress(), tokenId);
    expect(await nft.getApproved(tokenId)).to.be.eq(await market.getAddress());
}

describe("FixedPrice test", function() {
    beforeEach(async function() {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(market, nft);
        
        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await market.getAddress());

        // check event
        const events = await getLotAddedEvents(market);
        expect(events?.length).to.be.eq(1);
        const event = events[0];
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await market.totalLots()) - 1);
            expect(event.item).to.be.eq(await nft.getAddress());
            expect(event.price).to.be.eq(lotInfo.price);
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await market.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.price).to.be.eq(lotInfo.price);
        expect(auctionLot.state).to.be.eq(0);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.buyer).to.be.eq(await owner.getAddress()); 
    });

    it ("Should be possible to buy lot", async function() {
        await addLot(market, nft);
        
        const lotInfo = await market.getLotInfo(0);
        const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
        await market.connect(buyer).buyLot(0, {value: lotInfo.price});

        // check events
        const event = await getLotSoldEvent(market);

        const fee = await market.fee();
        const feeValue = lotInfo.price * fee / BigInt(10000);

        expect(event?.id).to.be.eq(0);
        expect(event?.buyer).to.be.eq(buyer.address);
        expect(event?.price).to.be.eq(lotInfo.price - feeValue);

        expect(await nft.ownerOf(0)).to.be.eq(buyer.address);
        expect((await ethers.provider.getBalance(owner.address)) - ownerBalanceBefore).to.be.eq(lotInfo.price - feeValue);
    });

    it ("Should be possible to close lot", async function() {
        await addLot(market, nft);
        await market.closeLot(0);

        // check events
        const event = await getLotClosedEvent(market);

        expect(event?.id).to.be.eq(0);
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        expect((await market.getLotInfo(0)).state).to.be.eq(2);
    });

    it ("Should not be possible to close lot if AuctionState is Closed", async function() {
        await addLot(market, nft);
        await market.closeLot(0);

        await expect(market.closeLot(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should not be possible to close lot if AuctionState is Sold", async function() {
        await addLot(market, nft);
        await market.connect(buyer).buyLot(0, {value: lotInfo.price});

        await expect(market.closeLot(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should be possible to withdraw fee", async function() {
        await addLot(market, nft);

        const lotInfo = await market.getLotInfo(0);

        await market.connect(buyer).buyLot(0, {value: lotInfo.price});

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const feeValue = lotInfo.price * fee / BigInt(10000);
        const tx = await market.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const transactionFee = getTransactionFee(tx, receipt);

        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
    });

    it ("Should be possible to update fee", async function() {
        expect(await market.fee()).to.be.eq(fee);
        const newFee = 400; //
        await market.updateFee(newFee); 

        expect(await market.fee()).to.be.eq(newFee);
    });

    it ("Should be batch add lot", async function() {
        const tokenIds: bigint[] = [];
        const prices: bigint[] = [];
        const durations: bigint[] = [];

        for (let i = 0; i < batchSize; i++) {
            tokenIds.push(BigInt(i));
            prices.push(ethers.parseEther("0.1"));
        }

        await market.addLotBatch(await nft.getAddress(), tokenIds, prices);
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(batchSize);

        for (let i = 0; i < batchSize; i++) {
            expect(events[i].id).to.be.eq(i);
            expect(events[i].item).to.be.eq(await nft.getAddress());
            expect(events[i].tokenId).to.be.eq(tokenIds[i]);
            expect(events[i].price).to.be.eq(prices[i]);
            expect(events[i].creator).to.be.eq(await owner.getAddress());
        }

        expect(await market.totalLots()).to.be.eq(batchSize);
    });
})