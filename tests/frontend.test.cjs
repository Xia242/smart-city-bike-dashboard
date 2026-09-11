const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function setup() {
    const nodes=new Map(),timers=new Map();let sequence=0;
    const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){}});return nodes.get(id);};
    const ctx=vm.createContext({console,alert(){},document:{getElementById:node},
        setTimeout(fn,ms){timers.set(++sequence,{fn,ms});return sequence;},clearTimeout(id){timers.delete(id);},
        setInterval(){return 1;},clearInterval(){},requestAnimationFrame(fn){fn();}});
    for(const file of ['state','chart-builder','ui-core','journey','mqtt-client'])
        vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
    vm.runInContext('render=()=>{}',ctx);
    return {ctx,nodes,timers,run:s=>vm.runInContext(s,ctx)};
}
function snapshot() {
    return {type:'FULL',timestamp:'12:00:00',total_bikes:1,zone_data:[
        {parking_id:'ST-01',name:'<img src=x onerror="evil()">',area:'<script>bad</script>',bikes:1,status:true,status_display:'NORMAL',historical_compare:'0%',context_tags:{rush_hour:false,holiday:false,event:'<svg onload="evil()">'},net_flow_per_min:0,depletion_eta_min:null,history:[],forecast:[],bike_ids:[{bike_id:'B1',status:'AVAILABLE'}]},
        {parking_id:'ST-02',name:'destination',area:'area',bikes:0,status:true,status_display:'NORMAL',historical_compare:'0%',context_tags:{rush_hour:false,holiday:false,event:'None'},net_flow_per_min:0,depletion_eta_min:null,history:[],forecast:[],bike_ids:[]}
    ]};
}
test('malicious text is escaped; executable identifiers and malformed updates are rejected atomically',()=>{
    const h=setup();h.ctx.payload=snapshot();h.run('validatePayload(payload);state.liveData=payload;freeze();renderSheetBody(getZone("ST-01"));');
    const html=h.nodes.get('sheet-body').innerHTML;
    assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>bad'));
    const bad=snapshot();bad.zone_data[0].parking_id="x');evil();//";h.ctx.bad=bad;
    assert.throws(()=>h.run('validatePayload(bad)'));
    h.run('onMessageArrived({payloadString:JSON.stringify(bad)})');
    assert.equal(h.run('state.liveData.zone_data[0].parking_id'),'ST-01');
    const invalid=snapshot();invalid.zone_data[0].bikes='oops';h.ctx.invalid=invalid;
    assert.throws(()=>h.run('validatePayload(invalid)'));
});
test('verification waits 15000 ms, cannot double-return, and Done keeps acknowledged placement',async()=>{
    const h=setup();h.ctx.payload=snapshot();h.ctx.calls=[];
    h.run(`state.liveData=payload;freeze();state.journey={state:'riding',originId:'ST-01',bikeId:'B1',returnId:null,rfidFail:false};
        sendCommand=async action=>{calls.push(action);state.liveData.zone_data[0].bike_ids=[];state.liveData.zone_data[0].bikes=0;state.liveData.zone_data[1].bike_ids=[{bike_id:'B1',status:'AVAILABLE'}];state.liveData.zone_data[1].bikes=1;freeze();};
        beginVerification('ST-02');`);
    assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,15000);
    assert.equal(h.ctx.calls.length,0);
    h.run("beginVerification('ST-02')");assert.equal(h.timers.size,1);
    await h.run('finishVerification()');await h.run('finishVerification()');
    assert.deepEqual(h.ctx.calls,['return']);h.run('endJourney()');
    assert.equal(h.run('state.displayData.zone_data[1].bikes'),1);
    assert.equal(h.run('state.journey.state'),'idle');
});
test('RFID failure holds the ride until retry succeeds',async()=>{
    const h=setup();h.ctx.payload=snapshot();h.run(`state.liveData=payload;freeze();state.journey={state:'riding',originId:'ST-01',bikeId:'B1',returnId:null,rfidFail:false};beginVerification('ST-02');state.journey.rfidFail=true;`);
    await h.run('finishVerification()');assert.equal(h.run('state.journey.state'),'verification_failed');
    h.run('retryVerification()');assert.equal(h.run('state.journey.state'),'verifying');
    assert.equal(h.timers.size,1);
});
test('MQTT command retries reuse the ID and acknowledgement validates before success',async()=>{
    const h=setup();h.ctx.payload=snapshot();h.ctx.sent=[];
    h.run(`state.liveData=payload;freeze();Paho={Message:class{constructor(p){this.payloadString=p}}};state.client={isConnected:()=>true,send:m=>sent.push(m)};`);
    const pending=h.run(`sendCommand('reserve','ST-01','B1')`);
    assert.equal(h.ctx.sent.length,1);
    [...h.timers.values()][0].fn();
    assert.equal(h.ctx.sent.length,2);
    assert.equal(h.ctx.sent[0].payloadString,h.ctx.sent[1].payloadString);
    h.ctx.requestId=JSON.parse(h.ctx.sent[0].payloadString).request_id;
    h.run(`onMessageArrived({destinationName:TOPIC+'/reply/'+CLIENT_ID,payloadString:JSON.stringify({request_id:requestId,ok:true,snapshot:payload})})`);
    await pending;
    assert.equal(h.run('state.pendingCommand'),false);
    assert.equal(h.run('pendingRequests.size'),0);
});
