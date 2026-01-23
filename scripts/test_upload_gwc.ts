
import dotenv from 'dotenv';
import { env } from 'process';

// Load .env
dotenv.config();

const API_BASE = 'http://localhost:4000/api/v1';
const CHAIN_ID = 'gwc';

// Helper headers
const headers = {
    'Content-Type': 'application/json',
};

async function main() {
    console.log('--- Starting GWC Upload Test ---');
    console.log(`Target: ${API_BASE}`);
    console.log(`Chain: ${CHAIN_ID}`);

    try {
        // 1. Check System Status
        console.log('\n1. Checking System Status...');
        const statusRes = await fetch(`${API_BASE}/system/status`, { headers });
        if (!statusRes.ok) throw new Error(`Status check failed: ${statusRes.status}`);
        const statusData = await statusRes.json();
        console.log('System Status:', JSON.stringify(statusData, null, 2));

        // 2. Check Chain Blocktime (Connectivity)
        console.log(`\n2. Checking ${CHAIN_ID} connectivity...`);
        const blocktimeRes = await fetch(`${API_BASE}/chains/${CHAIN_ID}/blocktime`, { headers });
        if (!blocktimeRes.ok) {
            console.warn(`Chain connectivity check failed: ${blocktimeRes.status} (Is the chain running?)`);
        } else {
            const blocktimeData = await blocktimeRes.json();
            console.log('Chain Blocktime:', JSON.stringify(blocktimeData, null, 2));
        }

        // 3. Create Dummy Transaction (Base64)
        // This is just a random string encoded in base64, not a valid tx.
        // It is sufficient to test the BFF -> Node pipeline, though the Node will reject it during EnsureCheckTx or DeliverTx.
        const dummyTx = Buffer.from('dummy-transaction-content-' + Date.now()).toString('base64');

        // 4. Simulate Transaction
        console.log('\n3. Simulating Transaction...');
        const simRes = await fetch(`${API_BASE}/chains/${CHAIN_ID}/simulate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ txBytesBase64: dummyTx })
        });

        const simData = await simRes.json();
        console.log('Simulation Result:', JSON.stringify(simData, null, 2));
        // We expect this might fail with an invalid tx error from the node, but that proves connectivity!

        // 5. Broadcast Batch (Upload)
        console.log('\n4. Broadcasting Batch (Upload)...');

        // Generate 5 dummy txs
        const batchList = Array.from({ length: 5 }).map((_, i) =>
            Buffer.from(`dummy-batch-tx-${i}-${Date.now()}`).toString('base64')
        );

        const batchRes = await fetch(`${API_BASE}/utils/load/broadcast-batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                chainId: CHAIN_ID,
                txBytesBase64List: batchList,
                broadcastMode: 'sync',
                maxConcurrency: 2
            })
        });

        if (!batchRes.ok) throw new Error(`Batch upload request failed: ${batchRes.status}`);

        const jobInfo = await batchRes.json() as { jobId: string };
        console.log(`Batch Job Started: ${jobInfo.jobId}`);

        // 6. Poll for Completion
        console.log('\n5. Polling Job Status...');
        await pollJob(jobInfo.jobId);

    } catch (err) {
        console.error('\n❌ Test Failed:', err);
        process.exit(1);
    }
}

async function pollJob(jobId: string) {
    const maxRetries = 30; // 30 seconds
    for (let i = 0; i < maxRetries; i++) {
        const res = await fetch(`${API_BASE}/utils/jobs/${jobId}`, { headers }); // Note: scope is implied in URL for get? No, route is /api/v1/utils/jobs/... wait.
        // Let's check routes. utils routes are mounted directly?
        // src/app.ts says: app.route('/utils', utilsRoutes)
        // so it is /api/v1/utils/jobs/:jobId

        if (!res.ok) {
            // Try without /utils prefix just in case (though app.ts says otherwise)
            console.warn(`Failed to poll job (attempt ${i + 1}): ${res.status}`);
        } else {
            const job = await res.json() as { status: string, result?: any, error?: string };
            console.log(`Job Status: ${job.status}`);

            if (job.status === 'succeeded') {
                console.log('Job Result:', JSON.stringify(job.result, null, 2));
                console.log('\n✅ Test Completed Successfully');
                return;
            } else if (job.status === 'failed') {
                console.error('Job Failed:', job.error);
                throw new Error('Job failed');
            }
        }

        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Timeout waiting for job completion');
}

main();
