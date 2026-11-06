export const PROTOCOL='cellcloud-peer/1';
export const NETWORK_IDS=Object.freeze(['testnet-10','mainnet']);
export function networkId(value){if(!NETWORK_IDS.includes(value))throw Error('UNSUPPORTED_NETWORK');return value;}
export function sameNetwork(expected,actual){networkId(expected);if(expected!==actual)throw Error('PEER_NETWORK_MISMATCH');}
export const NETWORKS=Object.freeze({
 'testnet-10':Object.freeze({prefix:'kaspatest',treasury:'kaspatest:qqn08lxxsvynt43l27geh7avapp3ujktqw7n3p99f9j75lakp3uwze7xm7pv6',pool:'kaspatest:qzjcjy6emyjjayp44tqzdaflqja54ckxkqrcvwfejqyhgpkq8ukj6hmdrrqa2',paymentsEnabled:true}),
 mainnet:Object.freeze({prefix:'kaspa',treasury:'kaspa:qypy2qak6dcrp4vdspea0rvv27z4tea5gtugd4jvxmhtz9k5wzj9jyc9572x0m2',pool:null,paymentsEnabled:false})
});
export function requirePaymentNetwork(id){const config=NETWORKS[networkId(id)];if(!config.paymentsEnabled||!config.pool)throw Error('MAINNET_PAYMENTS_NOT_ENABLED');return config;}
