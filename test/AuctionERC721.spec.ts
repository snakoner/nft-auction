import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/src/signers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {Auction, NFT} from "../typechain-types";
import "@nomicfoundation/hardhat-chai-matchers";
import { getTransactionFee } from "./common";

const batchSize = 20;
const tokenId = 0;
const fee = BigInt(20);  // 0.2%

interface Bidder {
    signer: HardhatEthersSigner;
    bid: bigint;
};

let market: Auction;
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
const getLotAddedEvents = async(market: Auction) => {
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
                startPrice: events[i].args?.startPrice,
                timeout: events[i].args?.timeout,
                creator: events[i].args?.creator
            }
        );    
    }

    return result;
}

const getLotBiddedEvents = async(market: Auction) => {
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

const getAuctionEndedEvent = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.LotEnded(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        id: events[0].args?.id,
        winner: events[0].args?.winner,
        finalPrice: events[0].args?.finalPrice,
    };
}

const getFeeWithdrawedEvents = async(market: Auction) => {
    let events = await market.queryFilter(market.filters.FeeWithdrawed(), 0, "latest");
    if (events.length == 0)
        return null;

    return {
        to: events[0].args?.to,
        amount: events[0].args?.amount,
    };
}

const getFeeUpdatedEvents = async(market: Auction) => {
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

const addLot = async(market: Auction) => {
    await market.addLot(
        lotInfo.item,
        lotInfo.tokenId,
        lotInfo.startPrice,
        lotInfo.duration
    );

    return lotInfo;
}

const init = async() => {
    owner = (await ethers.getSigners())[0];
    const accounts = (await ethers.getSigners()).slice(1,);
    
    // nft
    const nftFactory = await ethers.getContractFactory("NFT");
    nft = await nftFactory.deploy();
    await nft.waitForDeployment();
    
    lotInfo.item = await nft.getAddress();

    // auction
    const marketFactory = await ethers.getContractFactory("Auction");
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

describe("Auction test", function() {
    beforeEach(async function() {
        await init();
    });

    it ("Should be possible to add lot", async function() {
        await addLot(market);

        // check ownership of nft{tokenId}
        expect(await nft.ownerOf(lotInfo.tokenId)).to.be.eq(await market.getAddress());

        // check event
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(1);
        const event = events[0];
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
        
        await expect(market.endLot(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
    });

    it ("Should not be possible to end auction if AuctionState is Ended", async function() {
        await addLot(market);
        
        // future is here
        await ethers.provider.send('evm_increaseTime', [lotInfo.duration + 100]);
        await ethers.provider.send('evm_mine');
        await market.endLot(0);

        await expect(market.endLot(0)).to.be.revertedWithCustomError(market, "MarketplaceUnexpectedState");
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

    it ("Should be batch add lot", async function() {
        const tokenIds: bigint[] = [];
        const prices: bigint[] = [];
        const durations: bigint[] = [];

        for (let i = 0; i < batchSize; i++) {
            tokenIds.push(BigInt(i));
            prices.push(ethers.parseEther("0.1"));
            durations.push(BigInt(60 * 60 * 24 * 2));
        }

        await market.addLotBatch(await nft.getAddress(), tokenIds, prices, durations);
        const events = await getLotAddedEvents(market);
        expect(events.length).to.be.eq(batchSize);

        for (let i = 0; i < batchSize; i++) {
            expect(events[i].id).to.be.eq(i);
            expect(events[i].item).to.be.eq(await nft.getAddress());
            expect(events[i].tokenId).to.be.eq(tokenIds[i]);
            expect(events[i].startPrice).to.be.eq(prices[i]);
            expect(events[i].creator).to.be.eq(await owner.getAddress());
        }

        expect(await market.totalLots()).to.be.eq(batchSize);
    });
})