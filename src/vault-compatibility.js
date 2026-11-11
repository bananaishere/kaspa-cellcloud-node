// The current vault format needs reproducible signatures for later decryption.
// Public payment and ownership signing do not have this requirement.
export const KASTLE_VAULT_UNSUPPORTED='A Kastle não é compatível com a chave reproduzível deste cofre. Usa a KasWare validada para criar e abrir cofres privados. O Deploy público continua disponível na Kastle.';
export const vaultWalletIssue=wallet=>wallet?.id==='kastle'?KASTLE_VAULT_UNSUPPORTED:'';
