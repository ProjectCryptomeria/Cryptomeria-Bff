/**
 * Chain関連の型定義
 */
/** chainIdを検証 */
export function isValidChainId(chainId) {
    if (chainId === 'gwc' || chainId === 'mdsc') {
        return true;
    }
    return /^fdsc-\d+$/.test(chainId);
}
/** chainIdからservice名を生成 */
export function getServiceName(chainId) {
    return `cryptomeria-${chainId}`;
}
/** service名からchainIdを抽出 */
export function extractChainId(serviceName) {
    const match = serviceName.match(/^cryptomeria-(.+)$/);
    return match ? match[1] : null;
}
//# sourceMappingURL=chains.js.map