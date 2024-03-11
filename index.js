const { Connection, PublicKey } = require("@solana/web3.js");
const { Metaplex } = require('@metaplex-foundation/js');
const coinTicker = require('coin-ticker');
require('dotenv').config();

const RAYDIUM_PUBLIC_KEY = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const Raydium = new PublicKey(RAYDIUM_PUBLIC_KEY);

const HTTPS_URL = process.env.HTTPS_URL;

const connection = new Connection(HTTPS_URL);

async function getSolPrice() {
    const ticker = await coinTicker('bitfinex', 'SOL_USD');
    return ticker.last;
}

function main(connection, programAddress) {
    console.log("Monitoring logs for program:", programAddress.toString());
    let last_tx;
    try{
        connection.onLogs(
            programAddress, 
            ({ logs, signature}) => {            
                if (logs && last_tx!=signature && logs.some(log => log.includes("initialize2"))) {
                    last_tx = signature;
                    console.log("");
                    console.log("Signature for 'initialize2':", signature);
                    get_info(connection, signature);
                }
            },
            "finalized"
        );
    } catch (error) {
        console.error("Error fetching transaction info:", error);
    }
}

async function get_info(connection, transaction_hash) {
    try {
        const sol_price = await getSolPrice();

        const info_transaction = await connection.getParsedTransaction(
            transaction_hash, { maxSupportedTransactionVersion: 0 });
            
        const logMessages = info_transaction.meta.logMessages;
        const initialize2Messages = logMessages.filter(message => message.includes('initialize2:')); 
        const accounts = info_transaction?.transaction.message.instructions.find(ix => ix.programId.toBase58() === RAYDIUM_PUBLIC_KEY).accounts;
        const token = accounts[8].toBase58();
        console.log("New lp for :", token)
        
        let Amountcoin;
        let Opentime; 

        initialize2Messages.forEach(message => {
            const initializeMatch = message.match(/initialize2: InitializeInstruction2 { nonce: (\d+), open_time: (\d+), init_pc_amount: (\d+), init_coin_amount: (\d+) }/);
            if (initializeMatch && initializeMatch.length === 5) {
                const [, nonce, openTime, pcAmount, coinAmount] = initializeMatch;
                Amountcoin = coinAmount; 
                Opentime = openTime;
            }
        });

        const pool_sol = (info_transaction.meta.preBalances[0] - info_transaction.meta.postBalances[0])* 10**-9
        let decimals = await connection.getTokenSupply(accounts[8]);
        const token_balnce_pool = Amountcoin * 10**-decimals.value.decimals; 
        const price_token = ((pool_sol/token_balnce_pool) * sol_price).toFixed(8);
        const marketcap = (price_token * token_balnce_pool).toFixed(0);
        const liquidity = (pool_sol * 2 * sol_price).toFixed(0);
        

        if (liquidity > marketcap && liquidity < 1000) {
            return;
        } else {
            console.log("Open Time:", Opentime);
            console.log("Value of sol in pool:", pool_sol.toFixed(2));
            console.log("Value of token in pool:", (Amountcoin* 10**-decimals.value.decimals).toFixed(0));
            console.log("Price token :", price_token, "Marketcap :", marketcap,"$","Liqudity", liquidity,"$");
        }

        const senders = info_transaction.transaction.message.accountKeys.map(key => key.pubkey.toBase58());
        const contractDeployer = senders.find(sender => sender !== Raydium.toBase58());
        console.log("Contract Deployer:", contractDeployer);
        const contractDeployerPublicKey = new PublicKey(contractDeployer);
        const info_deployer = await connection.getBalance(contractDeployerPublicKey)
        console.log("Balance",(info_deployer*10**-9).toFixed(8),"Sol");

        const transactionHistory = await connection.getConfirmedSignaturesForAddress2(
            contractDeployerPublicKey,{limit: 10,});
        console.log("Age around:", ((Math.floor(Date.now() / 1000) - transactionHistory[transactionHistory.length - 1].blockTime)/60).toFixed(0), "minutes");

        const metaplex = new Metaplex(connection) 
        const nftMetadata = await metaplex.nfts().findByMint({mintAddress: new PublicKey(token)})
        if (nftMetadata.json.extensions) {
            console.log("Extensions:");
            const extensions = nftMetadata.json.extensions;
            Object.keys(extensions).forEach(key => {
                console.log(`${key}: ${extensions[key]}`);
            });
        }

    } catch (error) {
        console.error("Error fetching transaction info:", error);
    }
}

main(connection, Raydium);