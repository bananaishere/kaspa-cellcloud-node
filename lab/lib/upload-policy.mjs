import {GIB,LARGE_UPLOAD_LIMIT} from './large-policy.mjs';
export const TIER_LIMITS = Object.freeze({MICRO:5*1024*1024,STANDARD:50*1024*1024,HEAVY:500*1024*1024,SUPER_HEAVY:GIB,ENTERPRISE:2*GIB,ENTERPRISE_PLUS:LARGE_UPLOAD_LIMIT,UPDATE:LARGE_UPLOAD_LIMIT});
// Hard bound for both the uploaded file and total expanded ZIP content.
export const PILOT_UPLOAD_LIMIT = LARGE_UPLOAD_LIMIT;
export const DEPLOY_PRICES=Object.freeze({MICRO:50,STANDARD:100,HEAVY:250,SUPER_HEAVY:500,ENTERPRISE:800,ENTERPRISE_PLUS:1000,UPDATE:10});
export function deploymentPrice(tier,bytes=0){if(!Object.hasOwn(DEPLOY_PRICES,tier))throw Error('INVALID_TIER');return tier==='ENTERPRISE_PLUS'?800+200*Math.max(1,Math.ceil((bytes-2*GIB)/GIB)):DEPLOY_PRICES[tier];}
export const UPLOAD_TIMEOUT_MS = 30*60*1000;
export function recommendedTier(bytes){
  if(!Number.isSafeInteger(bytes)||bytes<0)return null;
  return ['MICRO','STANDARD','HEAVY','SUPER_HEAVY','ENTERPRISE','ENTERPRISE_PLUS'].find(tier=>bytes<=TIER_LIMITS[tier])||null;
}
export function tierAfterUpload(tier,bytes){
  const recommended=recommendedTier(bytes);
  return tier!=='UPDATE'&&recommended?recommended:tier;
}
export function uploadValidation(bytes,tier,serverLimit=PILOT_UPLOAD_LIMIT){
  const limit=TIER_LIMITS[tier];
  const invalid=!Number.isSafeInteger(bytes)||bytes<0||limit===undefined;
  const operationalLimit=Number.isSafeInteger(serverLimit)&&serverLimit>0?Math.min(serverLimit,PILOT_UPLOAD_LIMIT):PILOT_UPLOAD_LIMIT;
  return {blocked:invalid||bytes>limit||bytes>operationalLimit,excessBytes:invalid?0:Math.max(0,bytes-limit),recommended:recommendedTier(bytes),operationalLimit,transportExceeded:bytes>operationalLimit};
}
