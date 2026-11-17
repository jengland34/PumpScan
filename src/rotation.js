export function selectFairRefreshBatch(candidates=[],freshIds=new Set(),limit=20){
  const eligible=(Array.isArray(candidates)?candidates:[])
    .filter(c=>c?.address&&!freshIds.has(c.address))
    .slice()
    .sort((a,b)=>{
      const ta=Date.parse(a.lastRefreshAttemptAt||a.lastAttemptAt||a.lastDiscoveredAt||0)||0;
      const tb=Date.parse(b.lastRefreshAttemptAt||b.lastAttemptAt||b.lastDiscoveredAt||0)||0;
      return ta-tb;
    });
  return {batch:eligible.slice(0,Math.max(0,limit)),eligibleCount:eligible.length};
}
