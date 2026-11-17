import pg from 'pg';

let pool=null;
let status={configured:false,connected:false,lastWriteAt:null,lastError:null};

export function databaseStatus(){return {...status};}

export async function initialiseDatabase(){
  if(!process.env.DATABASE_URL){status={...status,configured:false,connected:false,lastError:'DATABASE_URL is not configured'};return null;}
  pool=new pg.Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false},
    max:4,
    idleTimeoutMillis:30000,
    connectionTimeoutMillis:10000,
    application_name:'pumpwatch'
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id=1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tokens (
      address TEXT PRIMARY KEY,
      symbol TEXT,
      name TEXT,
      first_discovered_at TIMESTAMPTZ,
      last_discovered_at TIMESTAMPTZ,
      last_evaluated_at TIMESTAMPTZ,
      source TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS market_snapshots (
      address TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      price_usd DOUBLE PRECISION,
      liquidity_usd DOUBLE PRECISION,
      volume_5m_usd DOUBLE PRECISION,
      volume_24h_usd DOUBLE PRECISION,
      buys_5m INTEGER,
      sells_5m INTEGER,
      payload JSONB NOT NULL,
      PRIMARY KEY(address, observed_at)
    );
    CREATE INDEX IF NOT EXISTS market_snapshots_observed_idx ON market_snapshots(observed_at DESC);
    CREATE TABLE IF NOT EXISTS score_history (
      address TEXT NOT NULL,
      evaluated_at TIMESTAMPTZ NOT NULL,
      score DOUBLE PRECISION,
      model TEXT,
      passed BOOLEAN,
      payload JSONB NOT NULL,
      PRIMARY KEY(address, evaluated_at)
    );
    CREATE INDEX IF NOT EXISTS score_history_score_idx ON score_history(score DESC, evaluated_at DESC);
    CREATE TABLE IF NOT EXISTS leaderboard_history (
      captured_at TIMESTAMPTZ NOT NULL,
      rank INTEGER NOT NULL,
      address TEXT NOT NULL,
      score DOUBLE PRECISION,
      payload JSONB NOT NULL,
      PRIMARY KEY(captured_at, rank)
    );
    CREATE INDEX IF NOT EXISTS leaderboard_address_idx ON leaderboard_history(address, captured_at DESC);
    CREATE TABLE IF NOT EXISTS scan_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  status={configured:true,connected:true,lastWriteAt:null,lastError:null};
  return pool;
}

export async function loadDatabaseState(){
  if(!pool)return null;
  const {rows}=await pool.query('SELECT payload FROM app_state WHERE id=1');
  return rows[0]?.payload||null;
}

export async function saveDatabaseState(state){
  if(!pool)return false;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO app_state(id,payload,updated_at) VALUES(1,$1::jsonb,now())
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,[JSON.stringify(state)]);
    const universe=Object.values(state.tokenUniverse||{});
    for(const token of universe){
      await client.query(`INSERT INTO tokens(address,symbol,name,first_discovered_at,last_discovered_at,last_evaluated_at,source,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT(address) DO UPDATE SET symbol=COALESCE(EXCLUDED.symbol,tokens.symbol),
        name=COALESCE(EXCLUDED.name,tokens.name),last_discovered_at=GREATEST(tokens.last_discovered_at,EXCLUDED.last_discovered_at),
        last_evaluated_at=GREATEST(tokens.last_evaluated_at,EXCLUDED.last_evaluated_at),
        source=COALESCE(EXCLUDED.source,tokens.source),payload=EXCLUDED.payload`,
        [token.address,token.symbol||null,token.name||null,token.firstDiscoveredAt||null,token.lastDiscoveredAt||null,token.lastEvaluatedAt||null,token.source||null,JSON.stringify(token)]);
    }
    for(const [address,history] of Object.entries(state.marketHistory||{})){
      for(const snap of history||[]){
        await client.query(`INSERT INTO market_snapshots(address,observed_at,price_usd,liquidity_usd,volume_5m_usd,volume_24h_usd,buys_5m,sells_5m,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(address,observed_at) DO NOTHING`,
          [address,snap.at,snap.priceUsd||null,snap.liquidityUsd||null,snap.volume5mUsd||null,snap.volume24hUsd||null,snap.buys5m??null,snap.sells5m??null,JSON.stringify(snap)]);
      }
    }
    for(const [address,c] of Object.entries(state.candidatePool||{})){
      const at=c.lastSuccessfulEvaluationAt||c.scannedAt;
      if(at)await client.query(`INSERT INTO score_history(address,evaluated_at,score,model,passed,payload)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(address,evaluated_at) DO NOTHING`,
        [address,at,Number.isFinite(Number(c.score))?Number(c.score):null,c.model||null,!!c.passed,JSON.stringify(c)]);
    }
    if(state.candidates?.length){
      const capturedAt=state.lastDiscoveryAt||new Date().toISOString();
      for(let i=0;i<state.candidates.length;i++){
        const c=state.candidates[i];
        await client.query(`INSERT INTO leaderboard_history(captured_at,rank,address,score,payload)
          VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(captured_at,rank) DO NOTHING`,
          [capturedAt,i+1,c.address,Number(c.score)||0,JSON.stringify(c)]);
      }
    }
    await client.query('COMMIT');
    status={configured:true,connected:true,lastWriteAt:new Date().toISOString(),lastError:null};
    return true;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    status={...status,connected:false,lastError:error.message};
    throw error;
  }finally{client.release();}
}

export async function closeDatabase(){if(pool){await pool.end();pool=null;}}
