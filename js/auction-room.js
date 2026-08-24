(function () {
  'use strict';
  window.FFOAuctionRoomV2 = true;

  const $ = (id) => document.getElementById(id);
  const A = window.FFOAuction, M = window.FFOAuctionMock, D = window.FFODraftIntelligence, DecisionConfidence = window.FFODecisionConfidence;
  const Session = window.FFODraftSession, SourceHealth = window.FFODraftSourceHealth;
  const HISTORY_KEY = 'ffo_auction_history_v2', SESSION_KEY = 'ffo_auction_session_v4';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const money = (value) => `$${Math.max(0, Math.round(Number(value) || 0))}`;
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const state = { intelligence:null, sourceHealth:null, projectionCoverage:null, modelValidation:null, league:null, profile:null, players:[], priceRows:new Map(), auction:null, selectedKey:null, history:null, model:null, historicalBacktest:null, pendingRestore:null, clockTimer:null };

  function defaultLeague() {
    return { name:'12-team Half-PPR Auction', league_type:'redraft', teams:12, scoring:{ reception:.5, pass_td:4, te_premium:0 }, roster:{ QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:0,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:6 }, draft:{ format:'auction',budget:200,minimum_bid:1 } };
  }

  function inputNumber(id, fallback) { return numeric($(id)?.value, fallback); }
  function leagueFromInputs() {
    const base = state.league || defaultLeague();
    const teams = Math.max(4, Math.min(20, Math.round(inputNumber('teamCount', base.teams || 12))));
    return { ...base, teams, total_rosters:teams, scoring:{ ...(base.scoring || {}), reception:inputNumber('scoringPpr', .5), pass_td:inputNumber('passingTd', 4), te_premium:inputNumber('tePremium', 0) }, roster:{ QB:inputNumber('rosterQB',1),RB:inputNumber('rosterRB',2),WR:inputNumber('rosterWR',2),TE:inputNumber('rosterTE',1),FLEX:inputNumber('rosterFLEX',2),SUPER_FLEX:inputNumber('rosterSF',0),WRRB_FLEX:inputNumber('rosterRBWR',0),REC_FLEX:inputNumber('rosterWRTE',0),K:inputNumber('rosterK',1),DST:inputNumber('rosterDST',1),BENCH:inputNumber('rosterBench',6) }, draft:{ ...(base.draft || {}),format:'auction',budget:Math.max(1,inputNumber('budget',200)),minimum_bid:Math.max(1,inputNumber('minbid',1)) } };
  }

  function applyLeagueInputs(league) {
    const roster = league.roster || {}, draft = league.draft || {};
    $('teamCount').value = league.teams || league.total_rosters || 12;
    $('userTeam').max = $('teamCount').value;
    $('userTeam').value = Math.min(inputNumber('userTeam', 7), inputNumber('teamCount', 12));
    $('budget').value = draft.budget || 200; $('minbid').value = draft.minimum_bid || 1;
    $('rosterQB').value = roster.QB ?? 1; $('rosterRB').value = roster.RB ?? 2; $('rosterWR').value = roster.WR ?? 2; $('rosterTE').value = roster.TE ?? 1;
    $('rosterFLEX').value = roster.FLEX ?? 2; $('rosterSF').value = roster.SUPER_FLEX ?? roster.SF ?? 0; $('rosterRBWR').value = roster.WRRB_FLEX ?? roster.RB_WR ?? 0; $('rosterWRTE').value = roster.REC_FLEX ?? roster.WR_TE ?? 0; $('rosterK').value = roster.K ?? 1; $('rosterDST').value = roster.DST ?? 1; $('rosterBench').value = roster.BENCH ?? roster.BN ?? 6;
    $('scoringPpr').value = league.scoring?.reception ?? .5; $('passingTd').value = league.scoring?.pass_td ?? league.scoring?.passing_td ?? 4; $('tePremium').value = league.scoring?.te_premium ?? league.scoring?.tePremium ?? 0;
    $('formatPreset').value = numeric(roster.SUPER_FLEX ?? roster.SF,0) > 0 ? 'superflex' : numeric(league.scoring?.te_premium ?? league.scoring?.tePremium,0) > 0 ? 'tep' : numeric(roster.WR,2) >= 3 ? 'threewr' : 'standard';
    $('league-note').textContent = `Active settings: ${league.name || 'Custom league'} · ${formatLabel(league)}.`;
  }

  function contextFor(roster = [], league = leagueFromInputs(), poolSize = state.players.length) {
    return { strategy:'adaptive',league,teams:league.teams,round:roster.length+1,totalRounds:A.rosterSlotCount(league),picks:roster,counts:D.rosterCounts(roster),targets:D.starterTargets(league),superflex:numeric(league.roster?.SUPER_FLEX,0)>0,poolSize:Math.max(1,poolSize),survival:50,players:state.players,projectionCoverage:state.projectionCoverage };
  }

  function preparePlayers(league) {
    const profile = D.selectProfile(state.intelligence, league);
    if (!profile) throw new Error('No compatible valuation profile for this league.');
    let players = D.enrichPlayers([], profile);
    // Some format-specific profiles omit K/DST even though another current
    // redraft profile contains them. Use the complete snapshot as the
    // supplemental source so every configured roster slot can be filled.
    const supplementalPlayers = Object.values(state.intelligence.profiles || {})
      .flatMap((candidateProfile) => candidateProfile?.players || []);
    players = D.mergeSupplementalPositions(players, supplementalPlayers, league);
    players.forEach((player) => {
      if (numeric(player.projectedPoints ?? player.projected_points, null) == null) return;
      player.rawProjectedPoints = numeric(player.rawProjectedPoints, player.projectedPoints ?? player.projected_points);
      player.projectedPoints = D.leagueAdjustedProjectedPoints(player, league);
    });
    const context = contextFor([], league, players.length);
    state.projectionCoverage = D.projectionCoverageContract(players, context);
    context.projectionCoverage = state.projectionCoverage;
    const vbd = state.projectionCoverage.complete ? D.computeVBDPercentiles(players, context) : {};
    players.forEach((player) => {
      if (vbd[player.key] != null) player.vbdPercentileScore = vbd[player.key];
      player.leagueValue = D.leagueValueScore(player, context);
      player.projectedPoints = numeric(player.projectedPoints ?? player.projected_points, null);
      const late = D.lateRoundValueScore(player, context);
      player.diamondScore = late.score;
      player.diamondConfidence = late.confidence;
      player.diamondLabel = late.label;
    });
    const pricing = A.buildIntrinsicPrices(players, { league,teams:league.teams,budget:league.draft.budget,minBid:league.draft.minimum_bid,valueField:'leagueValue' });
    state.profile = profile; state.players = players; state.priceRows = new Map(pricing.rows.map((row) => [M.keyOf(row.player), row]));
    return { players, pricing };
  }

  function remainingBaseline(auction = state.auction) {
    const slotsNeeded = Object.values(auction.teams).reduce((sum, team) => sum + team.slotsLeft, 0);
    return M.availablePlayers(auction)
      .map((player) => numeric(auction.priceMap[M.keyOf(player)], auction.config.minBid))
      .sort((a, b) => b - a)
      .slice(0, slotsNeeded)
      .reduce((sum, value) => sum + value, 0);
  }
  function roomInflation(auction = state.auction) {
    if (!auction) return 1;
    const teams = Object.values(auction.teams), dollars = teams.reduce((sum, team) => sum + team.remainingBudget, 0), slots = teams.reduce((sum, team) => sum + team.slotsLeft, 0);
    return A.roomInflation({ remainingDollars:dollars,remainingBaselineValue:remainingBaseline(auction),remainingSlots:slots,minBid:auction.config.minBid });
  }

  function updateAdaptiveModel({ rebuildBacktest = false } = {}) {
    const budget = state.auction?.config?.budget || inputNumber('budget', 200);
    const history = state.history || { budget, seasons:[] };
    if (rebuildBacktest || !state.historicalBacktest) state.historicalBacktest = A.calibrationBacktest(history,{budget});
    state.model = A.adaptiveLeagueModel(history,state.auction?.purchases||[],{budget});
    state.model.backtest = state.historicalBacktest;
    if (state.auction) state.auction = { ...state.auction,leagueModel:state.model };
  }

  function refreshExpectedPrices() {
    if (!state.auction) return;
    const inflation = roomInflation(), map = {};
    M.availablePlayers(state.auction).forEach((player) => {
      const intrinsic = M.intrinsicPrice(state.auction, player);
      const capable = A.capableBidderCount(Object.values(state.auction.teams), intrinsic, state.auction.config.minBid);
      map[M.keyOf(player)] = A.expectedLeaguePrice({ intrinsicPrice:intrinsic,position:player.position,rank:player.overallRank??player.rank,tier:player.tier,model:state.model,currentInflation:inflation,capableBidders:capable });
    });
    state.auction = { ...state.auction,expectedPriceMap:map,expectedPriceMapSales:state.auction.purchases.length,leagueModel:state.model };
  }

  function newAuction({ preserveSelection = false } = {}) {
    const league = leagueFromInputs(), prepared = preparePlayers(league), userTeamId = String(Math.max(1,Math.min(league.teams,Math.round(inputNumber('userTeam',7)))));
    state.league = league;
    state.auction = M.createState({ league,players:prepared.players,userTeamId,seed:29,priceMap:prepared.pricing.prices,leagueModel:state.model,projectionCoverage:state.projectionCoverage,biddingSeconds:inputNumber('biddingSeconds',20),bidResetSeconds:inputNumber('bidResetSeconds',10) });
    updateAdaptiveModel({ rebuildBacktest:true });
    if (!preserveSelection) state.selectedKey = null;
    refreshExpectedPrices(); syncCompatibilityFields(); save(); render();
  }

  function compactState() {
    const auction = state.auction;
    return auction ? { version:auction.version,userTeamId:auction.userTeamId,teams:auction.teams,draftedKeys:auction.draftedKeys,purchases:auction.purchases,nominationIndex:auction.nominationIndex,nomination:auction.nomination,status:auction.status,seed:auction.seed,auctionClock:auction.auctionClock } : null;
  }

  function sessionPayload() {
    const auction = state.auction, mine = auction?.teams?.[auction.userTeamId];
    return { version:Session?.SCHEMA_VERSION || 4,leagueId:state.league?.id||state.league?.league_id||null,initialBudget:auction?.config?.budget||inputNumber('budget',200),remainingBudget:mine?.remainingBudget??inputNumber('budget',200),slotsLeft:mine?.slotsLeft??A.rosterSlotCount(state.league||defaultLeague()),leagueRemaining:Object.values(auction?.teams||{}).reduce((sum,team)=>sum+team.remainingBudget,0),leagueSlotsLeft:Object.values(auction?.teams||{}).reduce((sum,team)=>sum+team.slotsLeft,0),minBid:auction?.config?.minBid||inputNumber('minbid',1),myRoster:mine?.roster||[],sold:(auction?.purchases||[]).map((purchase)=>({ ...purchase.player,price:purchase.price,winner:purchase.teamId===auction.userTeamId?'me':'room',teamId:purchase.teamId })),selectedKey:state.selectedKey,nomination:auction?.nomination||null,mockState:compactState(),leagueSnapshot:state.league,sourceSnapshot:{generated_at:state.intelligence?.generated_at||state.intelligence?.meta?.generated_at||null} };
  }
  function save() {
    if (!Session || !state.auction) return;
    const result = Session.safeSave(localStorage, SESSION_KEY, 'auction', sessionPayload(), { leagueName:state.league?.name||'Auction Mock' });
    if (!result.ok) showError(result.issues.join(' · '));
  }
  function loadSaved() {
    if (!Session) return null;
    const result = Session.safeLoad(localStorage, SESSION_KEY, 'auction');
    if (!result.ok) { showError(result.issues.join(' · ')); return null; }
    return result.payload || null;
  }
  function restoreSaved(payload) {
    if (!payload?.mockState) return false;
    state.league = payload.leagueSnapshot || state.league || defaultLeague(); applyLeagueInputs(state.league);
    const prepared = preparePlayers(state.league), base = M.createState({ league:state.league,players:prepared.players,userTeamId:payload.mockState.userTeamId,seed:payload.mockState.seed,priceMap:prepared.pricing.prices,leagueModel:state.model,projectionCoverage:state.projectionCoverage,biddingSeconds:payload.mockState.auctionClock?.biddingSeconds||inputNumber('biddingSeconds',20),bidResetSeconds:payload.mockState.auctionClock?.bidResetSeconds||inputNumber('bidResetSeconds',10) });
    state.auction = { ...base,...payload.mockState,league:state.league,config:base.config,players:base.players,priceMap:base.priceMap,expectedPriceMap:base.expectedPriceMap,leagueModel:state.model };
    state.selectedKey = payload.selectedKey || null; updateAdaptiveModel(); refreshExpectedPrices(); syncCompatibilityFields(); return true;
  }

  function showError(message) { $('auction-recovery').style.display='block'; $('auction-recovery-message').textContent=message; $('auction-session-status').textContent='ERROR'; }
  function clearError() { $('auction-recovery').style.display='none'; }
  function syncCompatibilityFields() {
    if (!state.auction) return;
    const mine = state.auction.teams[state.auction.userTeamId], teams = Object.values(state.auction.teams);
    $('remaining').value=mine.remainingBudget; $('slots').value=mine.slotsLeft; $('leagueRemaining').value=teams.reduce((sum,team)=>sum+team.remainingBudget,0); $('leagueSlots').value=teams.reduce((sum,team)=>sum+team.slotsLeft,0);
  }

  function userAnalysis(player) {
    const auction = state.auction, mine = auction.teams[auction.userTeamId], intrinsic = M.intrinsicPrice(auction,player), expected = M.expectedPrice(auction,player), maxBid = M.teamBidLimit(auction,auction.userTeamId,player), current = auction.nomination?.playerKey===M.keyOf(player)?auction.nomination.currentBid:expected;
    const context = contextFor(mine.roster,auction.league,M.availablePlayers(auction).length), draft = D.scorePlayer(player,context), scarcity = D.scarcityScore(player,M.availablePlayers(auction),{picksUntilNextTurn:10}), pointGain = M.marginalStarterPoints(mine,player,auction.league), need = M.positionalNeed(mine,player,auction.league), surplus=Math.round((intrinsic-current)*10)/10;
    const range=A.expectedLeaguePriceRange({intrinsicPrice:intrinsic,position:player.position,rank:player.overallRank??player.rank,tier:player.tier,model:state.model,currentInflation:roomInflation(),capableBidders:M.bidderLimits(auction,player).length});
    const evaluated=A.evaluatePlayer({player,intrinsicPrice:intrinsic,currentPrice:current,teamState:{remainingBudget:mine.remainingBudget,slotsLeft:mine.slotsLeft,leagueModel:state.model},draftEvaluation:draft,scarcity:scarcity.scarcity,tierUrgency:player.tierEnd?80:50,upside:numeric(player.pedigreeScore,50),capableBidders:M.bidderLimits(auction,player).length,inflation:roomInflation(),minBid:auction.config.minBid,availablePlayers:M.availablePlayers(auction),priceForPlayer:(candidate)=>M.intrinsicPrice(auction,candidate)});
    return {intrinsic,expected,maxBid,current,draft,scarcity,pointGain,need,surplus,range,recommendation:evaluated.recommendation,...evaluated};
  }

  function selectPlayer(key) { if (!state.auction || state.auction.draftedKeys.includes(String(key))) return; state.selectedKey=String(key); render(); save(); }
  function selectedPlayer() { return state.auction?.players.find((player)=>M.keyOf(player)===String(state.selectedKey)); }

  function renderBoard() {
    if (!state.auction) return;
    const available=M.availablePlayers(state.auction),filter=$('pos').value,query=$('search').value.trim().toLowerCase();
    const rows=available.filter((player)=>(filter==='ALL'||player.position===filter)&&(!query||player.name.toLowerCase().includes(query))).sort((a,b)=>M.intrinsicPrice(state.auction,b)-M.intrinsicPrice(state.auction,a)||numeric(a.overallRank,a.rank)-numeric(b.overallRank,b.rank)).slice(0,220);
    $('board').innerHTML=rows.map((player)=>{const analysis=userAnalysis(player),selected=M.keyOf(player)===String(state.selectedKey),wwpa=analysis.draft.wwpa;return `<div class="row auction-player ${selected?'selected-row':''}" data-k="${esc(M.keyOf(player))}"><div><div class="player-name"><span class="position-pill ${String(player.position).toLowerCase()}">${esc(player.position)}</span>${esc(player.name)}</div><div class="player-meta">Overall ${numeric(player.overallRank,player.rank)} · ${player.position}${numeric(player.posRank,null)!=null?numeric(player.posRank):'—'} · tier ${player.tier||'—'} · need ${Math.round(analysis.need)}${wwpa?` · ${wwpa.deltaPercentagePoints>=0?'+':''}${wwpa.deltaPercentagePoints.toFixed(1)} pp WWPA`:''}</div></div><div class="cell format-cell">${money(analysis.intrinsic)}</div><div class="cell">${money(analysis.expected)}</div><div class="cell max-cell" data-value="${money(analysis.maxBid)}">${money(analysis.maxBid)}</div><div class="action">${analysis.recommendation}</div></div>`}).join('')||'<div class="muted">No matching available players.</div>';
    document.querySelectorAll('#board [data-k]').forEach((row)=>row.onclick=()=>selectPlayer(row.dataset.k));
  }

  function renderValuation() {
    const player=selectedPlayer();
    if(!player){$('selected').textContent='Select a player from the board.';['intrinsic','leagueprice','currentbid','maxbid','auctionWalkAway','auctionWwpa','auctionWinRate','auctionWinRange','auctionConfidence','surplus','pointgain'].forEach((id)=>$(id).textContent='—');$('decision').textContent='';$('nomination').textContent='';$('why').textContent='';if($('auctionComparable'))$('auctionComparable').textContent='Select a player to compare the next option.';return}
    const a=userAnalysis(player),range=a.range.confidence==='UNMODELED'?money(a.expected):`${money(a.expected)} · ${money(a.range.low)}–${money(a.range.high)}`;
    $('selected').innerHTML=`<strong>${esc(player.name)}</strong> · ${esc(player.position)}<br><span class="meta">Consensus ${numeric(player.overallRank,player.rank)} · League Value ${numeric(a.draft.leagueValue).toFixed(1)} · ${a.scarcity.remainingSupply} remain</span>`;
    const wwpa=a.draft.wwpa,decisionCard=DecisionConfidence?DecisionConfidence.auctionCard({evaluation:a,sourceHealth:state.sourceHealth,projectionCoverage:state.projectionCoverage,validation:state.modelValidation,minBid:state.auction.config.minBid}):null;$('intrinsic').textContent=money(a.intrinsic);$('leagueprice').textContent=range;$('currentbid').textContent=money(a.current);$('maxbid').textContent=money(decisionCard?.bidThrough??a.maxBid);$('auctionWalkAway').textContent=decisionCard?money(decisionCard.walkAway):money(a.maxBid+state.auction.config.minBid);$('auctionWwpa').textContent=wwpa?`${wwpa.deltaPercentagePoints>=0?'+':''}${wwpa.deltaPercentagePoints.toFixed(1)} pp`:'—';$('auctionWwpa').className=wwpa&&wwpa.deltaPercentagePoints>0?'good':'';$('auctionWinRate').textContent=wwpa?`${wwpa.winRateAfter.toFixed(1)}%`:'—';$('auctionWinRange').textContent=decisionCard?`${decisionCard.range.low.toFixed(1)}–${decisionCard.range.high.toFixed(1)}%`:'—';$('auctionConfidence').textContent=decisionCard?`${decisionCard.trust.label} ${decisionCard.trust.score}`:'—';$('surplus').textContent=`${a.surplus>=0?'+':''}${money(a.surplus)}`;$('surplus').className=a.surplus>=0?'good':'risk';$('pointgain').textContent=a.pointGain>0?`+${a.pointGain.toFixed(1)}`:'Depth';$('decision').textContent=a.recommendation;
    $('nomination').textContent=`${a.bidAdvice} · ${a.current>=a.maxBid?'Ceiling reached':`${money(a.dollarsToCeiling)} left to ceiling`}.`;
    const alternativeWwpa=a.nextComparable?D.weeklyWinProbabilityAdded(a.nextComparable.player,contextFor(state.auction.teams[state.auction.userTeamId].roster,state.auction.league,M.availablePlayers(state.auction).length)):null;
    if($('auctionComparable'))$('auctionComparable').innerHTML=a.nextComparable?`<strong>${esc(a.nextComparable.player.name)} · ${esc(a.nextComparable.player.position)}</strong><span>${a.nextComparable.sameTier?'Same tier':'Next tier'} · saves about ${money(Math.max(0,a.current-a.nextComparable.price))} · ${money(a.nextComparable.price)} format value${alternativeWwpa?` · ${alternativeWwpa.deltaPercentagePoints>=0?'+':''}${alternativeWwpa.deltaPercentagePoints.toFixed(1)} pp WWPA`:''}</span>`:'<strong>No close substitute</strong><span>The position falls off sharply after this player.</span>';
    if($('auctionDecisionProof')&&decisionCard){const reasons=decisionCard.trust.reasons.length?decisionCard.trust.reasons.slice(0,2).join(' · '):'fresh complete evidence';$('auctionDecisionProof').innerHTML=`<strong>MODEL CHECK · ${esc(decisionCard.trust.label)} ${decisionCard.trust.score}/100</strong><div class="auction-trust-line"><span>${esc(decisionCard.proof)}</span><span>${esc(reasons)}</span><span>Bid through ${money(decisionCard.bidThrough)} · walk at ${money(decisionCard.walkAway)}</span></div>`;}
    $('why').textContent=`Format value reflects ${state.auction.league.teams} teams and ${formatLabel(state.auction.league)}. ${wwpa?`Acquisition changes expected weekly H2H win rate from ${wwpa.winRateBefore.toFixed(1)}% to ${wwpa.winRateAfter.toFixed(1)}% (${wwpa.deltaPercentagePoints>=0?'+':''}${wwpa.deltaPercentagePoints.toFixed(1)} pp WWPA) and adds ${wwpa.weeklyStarterPointsAdded.toFixed(1)} usable PPG. `:''}Roster need ${Math.round(a.need)}/100; scarcity ${Math.round(a.scarcity.scarcity)}/100; room ${roomInflation().toFixed(2)}×. Price confidence ${a.priceConfidence.toLowerCase()} (${a.historicalPriceEvidence} historical + ${a.livePriceEvidence} current-room observations); ${a.priceConfidence==='UNMODELED'?'premium capped at 12% above format value until room evidence exists. ':a.priceConfidence==='LIVE-ADAPTING'?'live adjustment is shrunk toward neutral and the premium remains capped at 16%. ':''}Maximum bid preserves ${Math.max(0,state.auction.teams[state.auction.userTeamId].slotsLeft-1)} future minimum bids.`;
    if(!$('currentPrice').dataset.manual)$('currentPrice').value=Math.max(state.auction.config.minBid,Math.round(a.expected));
  }

  function formatLabel(league) { const roster=league.roster||{};return `${roster.QB||0}QB · ${roster.RB||0}RB · ${roster.WR||0}WR · ${roster.TE||0}TE · ${roster.FLEX||0}FLEX${numeric(roster.SUPER_FLEX,0)?` · ${roster.SUPER_FLEX}SF`:''}${numeric(roster.WRRB_FLEX??roster.RB_WR,0)?` · ${numeric(roster.WRRB_FLEX??roster.RB_WR)} RB/WR`:''}${numeric(roster.REC_FLEX??roster.WR_TE,0)?` · ${numeric(roster.REC_FLEX??roster.WR_TE)} WR/TE`:''} · ${numeric(league.scoring?.pass_td??league.scoring?.passing_td,4)}pt pass TD${numeric(league.scoring?.te_premium,0)?` · +${league.scoring.te_premium} TE PPR`:''}`; }

  function renderLot() {
    const auction=state.auction, nomination=auction?.nomination, nominator=auction?M.nextNominator(auction):null;
    $('mockStatus').textContent=auction?.status||'READY';
    if(!nomination){$('lotPlayer').textContent=auction?.status==='COMPLETE'?'Auction complete':auction?.status==='AWAITING_NOMINATION'?'Your nomination':'Waiting for next nomination';$('lotMeta').textContent=auction?.status==='AWAITING_NOMINATION'?'Select a player, then tap Nominate Selected.':auction?.status==='COMPLETE'?'Every roster spot and purchase has been resolved.':nominator?`${auction.teams[nominator.id].name} nominates next.`:'Start a new auction.';$('lotBid').textContent='—';$('lotLeader').textContent='';$('lotClock').textContent='—';$('lotClock').parentElement.classList.remove('urgent');$('bidHistory').textContent=auction?.status==='AWAITING_NOMINATION'?'Your turn: choose any available player to nominate.':'Nominate a player to open bidding.';}
    else{const player=auction.players.find((item)=>M.keyOf(item)===nomination.playerKey),remaining=Math.max(0,Math.ceil(numeric(nomination.secondsRemaining,0)));$('lotPlayer').textContent=`${player.name} · ${player.position}`;$('lotMeta').textContent=`Nominated by ${auction.teams[nomination.nominatorTeamId].name} · open bidding for every team`;$('lotBid').textContent=money(nomination.currentBid);$('lotLeader').textContent=`${auction.teams[nomination.leaderTeamId]?.name||'Room'} leads`;$('lotClock').textContent=`0:${String(remaining).padStart(2,'0')}`;$('lotClock').parentElement.classList.toggle('urgent',remaining<=numeric(auction.auctionClock?.bidResetSeconds,10));$('bidHistory').innerHTML=(nomination.bidHistory||[]).slice(-8).map((bid)=>`<span>${esc(auction.teams[bid.teamId]?.name||bid.teamId)} ${money(bid.amount)}</span>`).join('');if(state.selectedKey!==nomination.playerKey)state.selectedKey=nomination.playerKey;$('customBid').min=String(nomination.currentBid+1);if(document.activeElement!==$('customBid'))$('customBid').value=String(nomination.currentBid+1);}
    const awaitingNomination=auction?.status==='AWAITING_NOMINATION',bidding=Boolean(nomination)&&auction?.status==='BIDDING',userPassed=nomination?.passedTeamIds?.includes(auction?.userTeamId),userLeading=nomination?.leaderTeamId===auction?.userTeamId,userLimit=nomination?M.teamBidLimit(auction,auction.userTeamId,auction.players.find((item)=>M.keyOf(item)===nomination.playerKey)):0,canBid=bidding&&!userPassed&&!userLeading&&userLimit>nomination.currentBid;$('nominateSelected').disabled=!awaitingNomination||!selectedPlayer();$('bidLot').disabled=!canBid;$('passLot').disabled=!bidding||userPassed||userLeading;$('advanceMock').disabled=!auction||['AWAITING_NOMINATION','BIDDING','COMPLETE'].includes(auction.status);
    $('bidLot').textContent=canBid?`Bid ${money(nomination.currentBid+1)}`:'Bid +$1';

  }

  function renderRosterAndTeams() {
    if(!state.auction)return;const auction=state.auction,mine=auction.teams[auction.userTeamId],purchases=auction.purchases||[];
    $('roster').innerHTML=mine.roster.length?mine.roster.slice().sort((a,b)=>numeric(b.price)-numeric(a.price)).map((player)=>`<div class="row"><div>${esc(player.name)} <span class="meta">${esc(player.position)}</span></div><strong>${money(player.price)}</strong></div>`).join(''):'No purchases recorded.';
    const baseline=remainingBaseline()/Math.max(1,auction.config.teams),health=A.budgetHealth({remainingBudget:mine.remainingBudget,slotsLeft:mine.slotsLeft,minBid:auction.config.minBid,targetSpendRemaining:baseline});$('budgetHealth').textContent=`${money(mine.remainingBudget)} · ${mine.slotsLeft} left · ${health.status}`;$('budgetHealth').className=`status ${health.status==='OVERSPENT'?'risk':health.status==='UNDERSPENT'?'teal':'good'}`;
    $('teamBoard').innerHTML=Object.values(auction.teams).map((team)=>`<div class="team-card ${team.id===auction.userTeamId?'mine':''}"><div class="team-card-head"><strong>${esc(team.name)}</strong><strong>${money(team.remainingBudget)}</strong></div><div class="team-card-meta">${team.slotsLeft} slots left · ${M.optimalStarterPoints(team.roster,auction.league).toFixed(1)} starter value · ${esc(team.strategy)}</div><div class="team-roster-chips">${team.roster.map((player)=>`<span>${esc(player.position)} ${esc(player.name.split(' ').slice(-1)[0])} ${money(player.price)}</span>`).join('')||'<span>Empty</span>'}</div></div>`).join('');
    $('purchaseCount').textContent=`${purchases.length} of ${auction.config.totalSlots} purchases`;$('roomSummary').textContent=`${money(Object.values(auction.teams).reduce((sum,team)=>sum+team.remainingBudget,0))} unspent`;
    $('salesLog').innerHTML=purchases.length?purchases.slice(-20).reverse().map((purchase,index)=>`<div class="sale-row"><span>#${purchases.length-index}</span><span>${esc(purchase.player.name)} · ${esc(auction.teams[purchase.teamId].name)}</span><strong>${money(purchase.price)}</strong></div>`).join(''):'No sales yet.';
  }

  function renderTendencies(){if(!state.model){$('tendencies').textContent='Room pricing will begin learning after three completed sales.';return}const live=state.model.live,liveDelta=live?.overall?Math.round((live.overall.median_ratio-1)*100):0,livePositions=Object.entries(live?.position||{}).filter(([,value])=>value.n>=2).map(([position,value])=>`${position}: ${value.median_ratio>=1?'+':''}${Math.round((value.median_ratio-1)*100)}% · ${value.n} sales`).join('<br>'),roomRead=live?.samples?`<strong>ROOM READ · ${live.status} · ${live.samples} sales · ${liveDelta>=0?'+':''}${liveDelta}% vs format baseline</strong><br>${live.active?'<strong>PRICE MODE · LIVE-ADAPTING</strong> · current-room observations are shrunk toward neutral and hard-bounded.':'Three completed sales are required before prices move.'}${livePositions?`<br>${livePositions}`:''}`:'<strong>ROOM READ · COLD</strong><br>Complete three sales to activate league-specific price learning.';const bits=Object.entries(state.model.position||{}).map(([position,value])=>`${position}: ${Math.round((value.median_ratio-1)*100)}% vs baseline · ${value.confidence.toLowerCase()} confidence (${value.n})`),backtest=state.model.backtest,bias=backtest?.overall?.bias||0,biasLabel=`${bias>=0?'+':'-'}${money(Math.abs(bias))}`,validation=backtest?.sufficient?`<br><br><strong>Leave-one-season-out validation</strong><br>MAE ${money(backtest.overall.mae)} · RMSE ${money(backtest.overall.rmse)} · bias ${biasLabel} across ${backtest.overall.n} held-out sales.`:'<br><br><strong>HISTORICAL VALIDATION PENDING</strong><br>Live room learning is labeled separately and does not claim backtest calibration.',historical=state.model.rows?`<br><br><strong>${state.model.matchedRows} matched historical purchases · MAE ${money(state.model.overall.mae)}</strong>${bits.length?`<br>${bits.join('<br>')}`:''}`:'';$('tendencies').innerHTML=`${roomRead}${historical}${validation}`;}
  function render(){if(!state.auction)return;clearError();syncCompatibilityFields();$('infl').textContent=`${roomInflation().toFixed(2)}×`;const projectionLabel=state.projectionCoverage?.complete?`projected-points mode (${state.projectionCoverage.directPlayers})`:`format-value fallback (${state.projectionCoverage?.directPlayers||0}/${state.projectionCoverage?.poolPlayers||state.players.length} projections)`,roomLabel=state.model?.live?.samples?`room read ${state.model.live.status.toLowerCase()} (${state.model.live.samples})`:'room read cold';$('source').textContent=`${state.sourceHealth&&SourceHealth?`${SourceHealth.label(state.sourceHealth)} · `:''}${state.profile?.id||'profile'} · ${state.players.length} players · ${projectionLabel} · ${roomLabel} · ${formatLabel(state.auction.league)}`;renderBoard();renderValuation();renderRosterAndTeams();renderTendencies();renderLot();save();}

  function openNextNomination(){if(!state.auction||state.auction.nomination||state.auction.status==='COMPLETE')return;const next=M.nextNominator(state.auction);if(!next){state.auction={...state.auction,status:'COMPLETE'};render();return}if(next.id===state.auction.userTeamId){state.auction={...state.auction,status:'AWAITING_NOMINATION'};}else{state.auction=M.startNomination(state.auction,{teamId:next.id});}render();}
  function clockTick(){if(!state.auction)return;if(state.auction.nomination&&state.auction.status==='BIDDING'){const sales=state.auction.purchases.length;state.auction=M.advanceClock(state.auction,{seconds:1,allowCpuBid:true});if(state.auction.purchases.length>sales){state.selectedKey=null;updateAdaptiveModel();refreshExpectedPrices();}render();if(!state.auction.nomination&&state.auction.status!=='COMPLETE')setTimeout(openNextNomination,700);}else if(state.auction.status==='RUNNING')openNextNomination();}
  function startClock(){if(state.clockTimer)clearInterval(state.clockTimer);state.clockTimer=setInterval(clockTick,1000);}
  function advanceToDecision(){if(!state.auction)return;openNextNomination();}
  function adaptiveSales(target,maxSteps=100000){let guard=0;while(state.auction.status!=='COMPLETE'&&state.auction.purchases.length<target&&guard<maxSteps){const sales=state.auction.purchases.length;state.auction=M.step(state.auction,{autoUser:true});if(state.auction.purchases.length>sales)updateAdaptiveModel();guard+=1;}if(guard>=maxSteps&&state.auction.status!=='COMPLETE')throw new Error('Auction simulation exceeded the safety limit.');}
  function autoSales(count){if(!state.auction)return;try{adaptiveSales(state.auction.purchases.length+count,20000);refreshExpectedPrices();render();}catch(error){showError(error.message)}}
  function finishAuction(){try{adaptiveSales(state.auction.config.totalSlots,100000);refreshExpectedPrices();save();render();}catch(error){showError(error.message)}}
  function bid(){try{state.auction=M.placeBid(state.auction,{teamId:state.auction.userTeamId,amount:inputNumber('customBid',state.auction.nomination.currentBid+1),kind:'USER_BID'});render();}catch(error){showError(error.message)}}
  function pass(){try{state.auction=M.passBid(state.auction,state.auction.userTeamId);render();}catch(error){showError(error.message)}}
  function nominate(){const player=selectedPlayer();if(!player)return;try{state.auction=M.startNomination(state.auction,{teamId:state.auction.userTeamId,playerKey:M.keyOf(player)});refreshExpectedPrices();render();}catch(error){showError(error.message)}}
  function recordManual(){const player=selectedPlayer();if(!player)return;try{let teamId=state.auction.userTeamId;if($('winner').value==='room'){const cpu=M.bidderLimits(state.auction,player).find((entry)=>entry.teamId!==state.auction.userTeamId);if(!cpu)throw new Error('No opponent can legally roster this player.');teamId=cpu.teamId}state.auction=M.recordPurchase(state.auction,{teamId,playerKey:M.keyOf(player),price:Math.max(state.auction.config.minBid,inputNumber('currentPrice',state.auction.config.minBid))});state.selectedKey=null;delete $('currentPrice').dataset.manual;updateAdaptiveModel();refreshExpectedPrices();render();}catch(error){showError(error.message)}}

  function applyPreset(value){const preset={standard:{QB:1,RB:2,WR:2,TE:1,FLEX:2,SF:0,K:1,DST:1,BENCH:6,ppr:.5,tep:0},threewr:{QB:1,RB:2,WR:3,TE:1,FLEX:2,SF:0,K:1,DST:1,BENCH:6,ppr:.5,tep:0},superflex:{QB:1,RB:2,WR:2,TE:1,FLEX:2,SF:1,K:1,DST:1,BENCH:5,ppr:.5,tep:0},tep:{QB:1,RB:2,WR:2,TE:1,FLEX:2,SF:0,K:1,DST:1,BENCH:6,ppr:1,tep:.5}}[value];if(!preset)return;['QB','RB','WR','TE','FLEX','K','DST'].forEach((pos)=>$(`roster${pos}`).value=preset[pos]);$('rosterSF').value=preset.SF;$('rosterRBWR').value=0;$('rosterWRTE').value=0;$('rosterBench').value=preset.BENCH;$('scoringPpr').value=preset.ppr;$('passingTd').value=4;$('tePremium').value=preset.tep;}
  function applyHistory(){try{const history=JSON.parse($('history').value);state.history=history;state.historicalBacktest=null;updateAdaptiveModel({rebuildBacktest:true});localStorage.setItem(HISTORY_KEY,JSON.stringify(history));$('history-status').textContent=`Loaded ${state.model.rows} purchases · ${state.model.backtest.sufficient?`held-out MAE ${money(state.model.backtest.overall.mae)}`:`in-sample MAE ${money(state.model.overall.mae)}`}.`;refreshExpectedPrices();render();}catch(error){$('history-status').textContent='Invalid history JSON.'}}

  function bind(){
    $('startMock').onclick=()=>{try{localStorage.removeItem(SESSION_KEY);newAuction();openNextNomination();startClock();}catch(error){showError(error.message)}};$('advanceMock').onclick=()=>advanceToDecision();$('autoTen').onclick=()=>autoSales(10);$('finishMock').onclick=()=>{if(confirm('Finish the remaining auction with CPU control for every team?'))finishAuction()};$('nominateSelected').onclick=nominate;$('bidLot').onclick=bid;$('passLot').onclick=pass;$('record').onclick=recordManual;$('resetCurrent').onclick=()=>{const player=selectedPlayer();if(!player)return;delete $('currentPrice').dataset.manual;$('currentPrice').value=Math.round(userAnalysis(player).expected);renderValuation()};$('currentPrice').oninput=()=>{$('currentPrice').dataset.manual='1'};$('pos').onchange=renderBoard;$('search').oninput=renderBoard;$('formatPreset').onchange=(event)=>applyPreset(event.target.value);$('teamCount').onchange=()=>{$('userTeam').max=$('teamCount').value;$('userTeam').value=Math.min(inputNumber('userTeam',1),inputNumber('teamCount',12))};$('apply').onclick=applyHistory;$('clear').onclick=()=>{localStorage.removeItem(HISTORY_KEY);state.history=null;state.historicalBacktest=null;updateAdaptiveModel({rebuildBacktest:true});$('history').value='';$('history-status').textContent='No league history loaded; current-room learning remains active.';refreshExpectedPrices();render()};$('retryData').onclick=boot;$('resetSession').onclick=()=>{localStorage.removeItem(SESSION_KEY);newAuction();render()};$('exportSession').onclick=()=>{const blob=new Blob([JSON.stringify(sessionPayload(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='fantasy-front-office-auction-session.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    document.addEventListener('ffo:league-changed',(event)=>{if(state.auction?.purchases?.length)return;state.league=event.detail||defaultLeague();applyLeagueInputs(state.league);if(state.intelligence)newAuction({preserveSelection:true})});
  }

  async function boot(){
    try{
      const [intelligenceResponse,validationResponse]=await Promise.all([
        fetch('data/draft_intelligence.json',{cache:'no-store'}),
        fetch('data/model_validation.json',{cache:'no-store'}),
      ]);
      if(!intelligenceResponse.ok)throw new Error(intelligenceResponse.status);
      state.intelligence=await intelligenceResponse.json();
      state.modelValidation=validationResponse.ok?await validationResponse.json():null;
      state.sourceHealth=SourceHealth?SourceHealth.assessRuntime({intelligence:state.intelligence,marketOk:true,scoutingOk:true,newsOk:true}):null;
      try{const savedHistory=JSON.parse(localStorage.getItem(HISTORY_KEY)||'null');if(savedHistory){state.history=savedHistory;state.historicalBacktest=null;updateAdaptiveModel({rebuildBacktest:true});$('history').value=JSON.stringify(savedHistory,null,2);$('history-status').textContent=`Loaded ${state.model.rows} historical purchases from this browser.`}}catch{}
      let handoff=null;try{if(new URLSearchParams(location.search).get('from')==='mock-draft')handoff=JSON.parse(localStorage.getItem('ffo_mock_draft_handoff_v1')||'null')}catch{}
      if(handoff?.league){state.league={...handoff.league,teams:handoff.teams||handoff.league.teams,draft:{...(handoff.league.draft||{}),format:'auction',budget:handoff.league.draft?.budget||200,minimum_bid:handoff.league.draft?.minimum_bid||1}};localStorage.removeItem('ffo_mock_draft_handoff_v1');applyLeagueInputs(state.league);newAuction()}
      else{const payload=loadSaved();if(!restoreSaved(payload)){state.league=window.FFO_ACTIVE_LEAGUE||defaultLeague();applyLeagueInputs(state.league);newAuction()}}
      render();
    }catch(error){showError(`Auction data could not load: ${error.message}`)}
  }

  bind();boot();
}());
