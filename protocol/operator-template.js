export function operatorTemplate(){
 return {version:1,network:'testnet-10',host:'127.0.0.1',port:8080,data:'./.local/cellcloud-node',quotaBytes:1073741824,origins:['http://127.0.0.1:5191','http://localhost:5191'],viewerOrigins:['http://{site}.viewer.localhost:5192'],peers:[],rpcUrl:'',logFile:'./.local/cellcloud-node-logs/node.log',publicUrl:'ws://127.0.0.1:8080/peer',expectedNodeId:null,syncIntervalMs:5000,repairIntervalMs:60000,reverseProxyTls:false,tls:null};
}
