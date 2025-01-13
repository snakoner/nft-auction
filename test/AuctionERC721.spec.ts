import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {AuctionERC721, NFT} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { getTransactionFee } from "./common";

const tokenId = 0;
const fee: bigint = BigInt(20);  // 0.2%
let market: AuctionERC721;
let nft: NFT;
let owner: HardhatEthersSigner;
let bidders: Bidder[] = [];
let lotInfo = {
    item: ethers.ZeroAddress,
    tokenId: tokenId,
    startPrice: ethers.parseEther("0.1"),
    duration: 60 * 60 * 24 * 2,      // 2 days
};

/* helpers */
const getLotAddedEvent = async(market: AuctionERC721) => {
    let events = await market.queryFilter(market.filters.LotAdded(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        item: events[0].args?.item,
        tokenId: events[0].args?.tokenId,
        startPrice: events[0].args?.startPrice,
        timeout: events[0].args?.timeout,
        creator: events[0].args?.creator
    };
}

const getLotBiddedEvents = async(market: AuctionERC721) => {
    let events = await market.queryFilter(market.filters.LotBidded(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            id: e.args?.id,
            bidder: e.args?.bidder,
            newPrice: e.args?.newPrice,
        });
    }

    return result;
}

const getAuctionEndedEvent = async(market: AuctionERC721) => {
    let events = await market.queryFilter(market.filters.LotEnded(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        winner: events[0].args?.winner,
        finalPrice: events[0].args?.finalPrice,
    };
}

const getFeeWithdrawedEvents = async(market: AuctionERC721) => {
    let events = await market.queryFilter(market.filters.FeeWithdrawed(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        to: events[0].args?.to,
        amount: events[0].args?.amount,
    };
}

const getFeeUpdatedEvents = async(market: AuctionERC721) => {
    let events = await market.queryFilter(market.filters.FeeUpdated(), 0, "latest");
    if (events.length == 0)
        return null;

    const result: any[] = [];
    for (const e of events) {
        result.push({
            oldFee: e.args?.oldFee,
            newFee: e.args?.newFee,    
        });
    }

    return result;
}

const addLot = async(market: AuctionERC721) => {
    await market.addLot(
        lotInfo.item,
        lotInfo.tokenId,
        lotInfo.startPrice,
        lotInfo.duration
    );

    return lotInfo;
}

interface Bidder {
    signer: HardhatEthersSigner;
    bid: bigint;
};

const init = async() => {
    owner = (await ethers.getSigners())[0];
    const accounts = (await ethers.getSigners()).slice(1,);
    
    // nft
    const nftFactory = await ethers.getContractFactory("NFT");
    nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    
    lotInfo.item = await nft.getAddress();

    // auction
    const marketFactory = await ethers.getContractFactory("AuctionERC721");
    market = await marketFactory.deploy(fee);
    await market.waitForDeployment();

    // mint and approve NFT
    await nft.mint();
    await nft.approve(await market.getAddress(), 0);

    expect(await nft.ownerOf(tokenId)).to.be.eq(await owner.getAddress());
    await nft.approve(await market.getAddress(), tokenId);
    expect(await nft.getApproved(tokenId)).to.be.eq(await market.getAddress());

    // create bidders
    bidders.length = 0;
    let prevBid = ethers.parseEther("0.1");
    const step = ethers.parseEther("0.1");
    for (const acc of  accounts) {
        bidders.push({
            signer: acc,
            bid: prevBid + step,
        });
        prevBid += step;
    }
}

describe("AuctionERC721 test", function() {
    beforeEach(async function() {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(market);

        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await market.getAddress());

        // check event
        const event = await getLotAddedEvent(market);
        if (event) {
            expect(event.creator).to.be.eq(await owner.getAddress());
            expect(event.id).to.be.eq(Number(await market.totalLots()) - 1);
            expect(event.item).to.be.eq(await nft.getAddress());
            expect(event.startPrice).to.be.eq(lotInfo.startPrice);
            expect(event.tokenId).to.be.eq(lotInfo.tokenId);    
        } else {
            throw Error("LotAdded event wasn't emitted");
        }

        // check storage
        const auctionLot = await market.getLotInfo(event.id);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await owner.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.bidsNumber).to.be.eq(0);    
        expect(auctionLot.state).to.be.eq(0); 
    });

    it ("Should be possible to make bid", async function() {
        await addLot(market);
        
        // make bid and make sure that prev bid returns to bidder
        for (let i = 0; i < bidders.length; i++) {
            let beforeBalance = BigInt(0);
            let afterBalance = BigInt(0);

            if (i != 0)
                beforeBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()))

            await market.connect(bidders[i].signer).bidLot(0, {value: bidders[i].bid});

            if (i != 0) {
                afterBalance = (await ethers.provider.getBalance(await bidders[i - 1].signer.getAddress()));
                expect(ethers.formatUnits(afterBalance - beforeBalance)).to.be.eq(ethers.formatUnits(bidders[i - 1].bid));
            }
        }

        // check events
        const events = await getLotBiddedEvents(market);
        expect(events?.length).to.be.eq(bidders.length);

        for (let i = 0; i < events.length; i++) {
            expect(events[i].id).to.be.eq(0);
            expect(events[i].bidder).to.be.eq(bidders[i].signer.address);
            expect(events[i].newPrice).to.be.eq(bidders[i].bid);
        }
    });

    it ("Should be possible to end auction if there is bidders", async function() {
        const bidder = bidders[0];

        await addLot(market);
        
        await market.connect(bidder.signer).bidLot(0, {value: bidder.bid});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(bidder.bid);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await market.endLot(0);
        const receipt = await tx.wait();

        const feeValue = bidder.bid * fee / BigInt(10000);

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(bidder.signer.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(feeValue);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(bidder.bid - getTransactionFee(tx, receipt) - feeValue);

        // storage after-check
        const auctionLot = await market.getLotInfo(0);
        expect(auctionLot.creator).to.be.eq(await owner.getAddress());
        expect(auctionLot.winner).to.be.eq(await bidder.signer.getAddress());
        expect(auctionLot.item).to.be.eq(await nft.getAddress());
        expect(auctionLot.startPrice).to.be.eq(lotInfo.startPrice);
        expect(auctionLot.lastPrice).to.be.eq(bidder.bid);
        expect(auctionLot.tokenId).to.be.eq(lotInfo.tokenId);    
        expect(auctionLot.bidsNumber).to.be.eq(1);    
        expect(auctionLot.state).to.be.eq(2); 

        // events check
        const event = await getAuctionEndedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(bidder.signer.address);
        expect(event?.finalPrice).to.be.eq(bidder.bid - feeValue);
    });

    it ("Should be possible to end auction if there is no bidders", async function() {
        await addLot(market);

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
        const tx = await market.endLot(0);
        const receipt = await tx.wait();

        /* checks */
        // nft owner is last bidder
        expect(await nft.ownerOf(0)).to.be.eq(owner.address);
        // contract balance is 0
        expect(await ethers.provider.getBalance(await market.getAddress())).to.be.eq(0);

        // previous owner of nft receinve last bid in ETH
        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());

        expect(ownerBalanceBefore - ownerBalanceAfter).to.be.eq(getTransactionFee(tx, receipt));

        // events check
        const event = await getAuctionEndedEvent(market);
        expect(event?.id).to.be.eq(0);
        expect(event?.winner).to.be.eq(owner.address);
        expect(event?.finalPrice).to.be.eq(0);        
    });

    it ("Should not be possible to end auction if AuctionState is active", async function() {
        await addLot(market);
        
        await expect(market.endLot(0)).to.be.revertedWithCustomError(market, "ERC721UnexpectedState");
    });

    it ("Should not be possible to end auction if AuctionState is Ended", async function() {
        await addLot(market);
        
        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        await market.endLot(0);

        await expect(market.endLot(0)).to.be.revertedWithCustomError(market, "ERC721UnexpectedState");
    });

    it ("Should be possible to withdraw fee", async function() {
        const bidder = bidders[0];

        await addLot(market);
        
        await market.connect(bidder.signer).bidLot(0, {value: bidder.bid});

        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');

        await market.endLot(0);

        const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());

        const feeValue = bidder.bid * fee / BigInt(10000);
        const tx = await market.withdrawFee(await owner.getAddress());
        const receipt = await tx.wait();
        const transactionFee = getTransactionFee(tx, receipt);

        const ownerBalanceAfter = await ethers.provider.getBalance(await owner.getAddress());
        expect(ownerBalanceAfter - ownerBalanceBefore).to.be.eq(feeValue - transactionFee);
        
        const event = await getFeeWithdrawedEvents(market);

        expect(event?.to).to.be.eq(await owner.getAddress());
        expect(event?.amount).to.be.eq(feeValue);
    });

    it ("Should be possible to update fee", async function() {
        expect(await market.fee()).to.be.eq(fee);
        const newFee = 400; //
        await market.updateFee(newFee); 

        expect(await market.fee()).to.be.eq(newFee);

        const events = await getFeeUpdatedEvents(market);
        expect(events?.length).to.be.eq(2);

        expect(events[0].oldFee).to.be.eq(0);
        expect(events[0].newFee).to.be.eq(fee);
        expect(events[1].oldFee).to.be.eq(fee);
        expect(events[1].newFee).to.be.eq(newFee);
    });
})