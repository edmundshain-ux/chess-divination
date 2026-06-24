import { useState, useEffect, useRef } from "react";
import { saveRecord, loadRecords, updateTeacherNote, saveAIConfig, loadAIConfig, saveTeacherMode, loadTeacherMode, getCurrentUserId } from "./db.js";

// ===== 棋子資料 =====
const PIECES = {
  將: { score: 80, color: "black" }, 帥: { score: 80, color: "red" },
  士: { score: 60, color: "black" }, 仕: { score: 60, color: "red" },
  象: { score: 40, color: "black" }, 相: { score: 40, color: "red" },
  車: { score: 30, color: "black" }, 俥: { score: 30, color: "red" },
  砲: { score: 15, color: "black" }, 包: { score: 15, color: "red" },
  馬B: { score: 20, color: "black" }, 馬R: { score: 20, color: "red" },
  卒: { score: 10, color: "black" }, 兵: { score: 10, color: "red" },
};

const DISP = { 馬B: "馬", 馬R: "馬" };
const d = (p) => DISP[p] || p;

const TYPE_MAP = {
  將: "將帥", 帥: "將帥",
  士: "士仕", 仕: "士仕",
  象: "象相", 相: "象相",
  車: "車俥", 俥: "車俥",
  砲: "砲包", 包: "砲包",
  馬B: "馬", 馬R: "馬",
  卒: "卒兵", 兵: "卒兵",
};

const ALT = {
  將: "帥", 帥: "將", 士: "仕", 仕: "士", 象: "相", 相: "象",
  車: "俥", 俥: "車", 砲: "包", 包: "砲", 馬B: "馬R", 馬R: "馬B",
  卒: "兵", 兵: "卒",
};

// 完整棋子池（依真實象棋數量）
const FULL_POOL = [
  "將",                           // 黑將 x1
  "帥",                           // 紅帥 x1
  "士","士",                      // 黑士 x2
  "仕","仕",                      // 紅仕 x2
  "象","象",                      // 黑象 x2
  "相","相",                      // 紅相 x2
  "車","車",                      // 黑車 x2
  "俥","俥",                      // 紅俥 x2
  "砲","砲",                      // 黑砲 x2
  "包","包",                      // 紅包 x2
  "馬B","馬B",                    // 黑馬 x2
  "馬R","馬R",                    // 紅馬 x2
  "卒","卒","卒","卒","卒",        // 黑卒 x5
  "兵","兵","兵","兵","兵",        // 紅兵 x5
];

const BLACK_LIST = ["將","士","象","車","砲","馬B","卒"];
const RED_LIST   = ["帥","仕","相","俥","包","馬R","兵"];

const col  = (p) => PIECES[p]?.color || null;
const sc   = (p) => PIECES[p]?.score || 0;
const tp   = (p) => TYPE_MAP[p] || "";
const same = (a,b) => a && b && (ALT[a]===b || ALT[b]===a || a===b);
const diff = (a,b) => a && b && col(a) !== col(b);

const STEP_ORDER = ["center","left","right","top","bottom"];
const POSITIONS = [
  { key:"center", label:"中", desc:"自己（本命）",       gridCol:2, gridRow:2 },
  { key:"top",    label:"上", desc:"長輩／父母／上司",   gridCol:2, gridRow:1 },
  { key:"bottom", label:"下", desc:"晚輩／子女／下屬",   gridCol:2, gridRow:3 },
  { key:"left",   label:"左", desc:"另一半／平輩異性",   gridCol:1, gridRow:2 },
  { key:"right",  label:"右", desc:"同輩男性／兄弟友人", gridCol:3, gridRow:2 },
];
const SURROUND = ["left","right","top","bottom"];
const QTYPES = [
  {key:"general",label:"整體運勢",icon:"☯"},
  {key:"love",   label:"感情緣分",icon:"♥"},
  {key:"career", label:"事業財運",icon:"◈"},
  {key:"health", label:"身體健康",icon:"✦"},
];

// ===== 占卜邏輯 =====

// 馬走日字：從中間出發，需要「一直一斜」
// 五格中：中間的馬可以走到 左/右/上/下 再斜一步
// 但五格只有上下左右，馬從中間走一直一斜後落點不在五格內
// 所以：馬在中間永遠吃不到周圍四格
// 馬在周圍：走日字可到達中間嗎？
//   - 左/右的馬：日字需走(1直2斜)，但距離中間是(1,0)，馬走日是(1,2)或(2,1)，到不了(1,0) → 吃不到
//   - 上/下的馬：同理 → 吃不到
// 結論：馬永遠吃不到中間，中間馬也吃不到周圍 ✓

// 但馬可以吃到「斜對角」的棋子：
// 例：上方馬 → 日字走法可達 左/右 位置（上1格+左右1格 = 日字）
// 例：左方馬 → 日字走法可達 上/下 位置
// 所以：馬在周圍可以吃到另一方向的棋子（跨位置攻擊）

// 判斷馬從surroundPos出發，能否吃到其他周圍的targetPos（非中間）
function horseCanEatOther(surroundPos, targetPos) {
  const pairs = {
    left: ["top","bottom"],
    right: ["top","bottom"],
    top: ["left","right"],
    bottom: ["left","right"],
  };
  return (pairs[surroundPos]||[]).includes(targetPos);
}

function canCenterEat(center, targetPos, pieces) {
  const t = tp(center);
  const target = pieces[targetPos];
  const tt = target ? tp(target) : "";
  // 士/象不能吃將帥
  if ((t==="士仕"||t==="象相") && tt==="將帥") return false;
  if (t==="將帥") return true;
  if (t==="車俥") return true;
  if (t==="馬") return false;   // 馬在中間無法走日字到達周圍
  if (t==="象相") return true;  // 象相可上下左右移動
  if (t==="士仕") return true;  // 士仕可上下左右移動
  if (t==="砲包") return false; // 砲在中間是困住格，無法攻擊（砲需從周圍跳過中間）
  if (t==="卒兵") {
    return ["top","left","right"].includes(targetPos);
  }
  return false;
}

function canSurroundEat(surround, surroundPos, pieces) {
  const t = tp(surround);
  const ct = tp(pieces.center);
  // 士/象不能吃將帥
  if ((t==="士仕"||t==="象相") && ct==="將帥") return false;
  if (t==="將帥") return true;
  if (t==="馬") return false;
  if (t==="象相") return true;
  if (t==="士仕") return true;
  if (t==="車俥") return true;
  if (t==="砲包") {
    return false;
  }
  if (t==="卒兵") {
    return ["left","right","bottom"].includes(surroundPos);
  }
  return false;
}

// 馬在周圍位置，能吃到哪些其他周圍位置（跨格攻擊）
// 回傳可攻擊的位置陣列
function horseAttackPositions(surroundPos) {
  const pairs = {
    left: ["top","bottom"],
    right: ["top","bottom"],
    top: ["left","right"],
    bottom: ["left","right"],
  };
  return pairs[surroundPos] || [];
}

function isFriend(center, sp, pos, pieces) {
  if (!center||!sp) return false;
  if (!same(center,sp)||!diff(center,sp)) return false;
  // 馬或砲在中間，沒有好朋友
  if (tp(center)==="馬"||tp(center)==="砲包") return false;
  // 砲在周圍：需要對面隔一子有同類異色砲
  if (tp(sp)==="砲包") {
    const opp={top:"bottom",bottom:"top",left:"right",right:"left"}[pos];
    const op=pieces[opp];
    return !!(op && same(op,sp) && diff(op,sp));
  }
  // 馬在周圍：需要另一個方向也有同類異色馬（日字配合）
  if (tp(sp)==="馬") {
    const pairs={left:["top","bottom"],right:["top","bottom"],top:["left","right"],bottom:["left","right"]};
    for (const np of (pairs[pos]||[])) {
      const np2=pieces[np];
      if (np2 && same(np2,sp) && diff(np2,sp)) return true;
    }
    return false;
  }
  // 其他：相鄰同類異色即為好朋友
  return true;
}

function getPieceTrait(p) {
  const t=tp(p);
  if (t==="將帥") return "掌權者，容易暴動，情緒起伏大";
  if (t==="士仕") return "有能力，聰明才智，自信心強";
  if (t==="象相") return "與房地產有緣，行動力較慢，火氣大";
  if (t==="車俥") return "執行力強，行動力佳";
  if (t==="砲包") return "有美感與創意，感情易形成砲友關係";
  if (t==="馬")   return "創意豐富，天馬行空，在外時間多";
  if (t==="卒兵") return "務實踏實，腳踏實地";
  return "";
}

function getConsumeTrait(p) {
  const t=tp(p);
  if (t==="將帥") return "個性暴動、情緒容易爆炸";
  if (t==="象相") return "火氣大、行動力更慢";
  if (t==="士仕") return "自以為是、過於憂慮";
  if (t==="車俥") return "過於衝動急躁";
  if (t==="砲包") return "內心恐懼、太想改變";
  if (t==="馬")   return "意念不定、方向飄移";
  if (t==="卒兵") return "想太多、行動力弱";
  return "";
}

function calculate(pieces, selfColor, qtype) {
  const center=pieces.center;
  const res={score:0,details:[],specials:[],warnings:[],relations:[],crossAttacks:[]};
  if (!center) return res;

  // 有無好朋友保護本命
  let hasFriend=false;
  for (const pos of SURROUND) { if(isFriend(center,pieces[pos],pos,pieces)){hasFriend=true;break;} }

  // 本命被通吃檢查
  let beingEaten=false;
  for (const pos of SURROUND) {
    const sp=pieces[pos];
    if (sp && col(sp)!==selfColor && canSurroundEat(sp,pos,pieces)) { beingEaten=true; break; }
  }

  // 中間能否主動反擊（吃到任何對方棋子）
  let canFightBack=false;
  for (const pos of SURROUND) {
    const sp=pieces[pos];
    if (sp && col(sp)!==selfColor && canCenterEat(center,pos,pieces)) { canFightBack=true; break; }
  }

  // 真正極凶：被吃 + 完全無法反擊 + 無好朋友保護
  if (beingEaten && !canFightBack && !hasFriend) {
    res.warnings.push({type:"danger",text:"⚠️ 本命棋子被對方吃掉，且無法反擊也無好朋友保護！此局極凶，建議重新起卦。"});
    res.score=null;
    return res;
  }

  // 先動先贏提示（被吃但能反擊，建議主動出擊）
  // 排除：包/馬困住、一枝獨秀
  const oppPiecesCount=SURROUND.filter(p=>pieces[p]&&col(pieces[p])!==selfColor).length;
  const isYiZhiDuXiuGlobal=oppPiecesCount===1;
  const centerIsTrapped = (tp(center)==="砲包" || tp(center)==="馬") && !canFightBack;
  if (beingEaten && canFightBack && !centerIsTrapped && !isYiZhiDuXiuGlobal) {
    res.warnings.push({type:"info",text:"⚡ 此局攻守兼備，先動先贏！建議主動出擊，掌握主導權"});
  }
  // 例：上方是馬，可攻擊左/右；左方是馬，可攻擊上/下
  const horseAttacks = {}; // horseAttacks[attackerPos][victimPos] = true
  for (const pos of SURROUND) {
    const sp=pieces[pos];
    if (!sp) continue;
    if (tp(sp)==="馬") {
      const targets=horseAttackPositions(pos);
      for (const tgt of targets) {
        if (!horseAttacks[pos]) horseAttacks[pos]=[];
        horseAttacks[pos].push(tgt);
      }
    }
  }

  for (const pos of SURROUND) {
    const sp=pieces[pos];
    if (!sp) continue;
    const spColor=col(sp);
    const isOwn=spColor===selfColor;
    const posInfo=POSITIONS.find(p=>p.key===pos);
    const friendCheck=isFriend(center,sp,pos,pieces);
    const centerEats=canCenterEat(center,pos,pieces);
    const surroundEats=canSurroundEat(sp,pos,pieces);

    let detail={pos,label:posInfo?.label,relation:posInfo?.desc,piece:sp,pieceColor:spColor,score:0,notes:[]};

    // === 士車特殊規則（好朋友的一種，各得對方分數一半）===
    const isShi=(p)=>tp(p)==="士仕";
    const isCar=(p)=>tp(p)==="車俥";
    if ((isShi(center)&&isCar(sp)||isCar(center)&&isShi(sp)) && diff(center,sp)) {
      const carP=isCar(center)?center:sp;
      const shiP=carP===center?sp:center;
      const carS=sc(carP), shiS=sc(shiP);
      // 士得車分數的一半，車得士分數的一半
      const shiGain=Math.floor(carS/2); // 士吃車得 車/2
      const carGain=Math.floor(shiS/2); // 車吃士得 士/2

      if (isCar(sp) && !isOwn) {
        // 對方是車，我方中間是士
        // 我方士得 +shiGain，對方車得 -carGain
        detail.score = shiGain - carGain;
        res.score += detail.score;
        detail.notes.push(`士車各半：我方士吃車得 +${shiGain}分，對方車吃士得 -${carGain}分，淨值 ${detail.score>=0?"+":""}${detail.score}分`);
      } else if (isCar(center) && !isOwn) {
        // 我方中間是車，對方是士
        // 我方車得 +carGain，對方士得 -shiGain
        detail.score = carGain - shiGain;
        res.score += detail.score;
        detail.notes.push(`士車各半：我方車吃士得 +${carGain}分，對方士吃車得 -${shiGain}分，淨值 ${detail.score>=0?"+":""}${detail.score}分`);
      } else {
        detail.notes.push(`士車各半（同陣）`);
      }
      detail.notes.push("✦ 士車特殊好朋友");
      res.details.push(detail); continue;
    }

    // === 好朋友規則 ===
    if (friendCheck) {
      const spS=sc(sp);
      const cS=sc(center);
      if (!isOwn) {
        if (surroundEats && centerEats) {
          // 雙方都能吃，好朋友各得一半
          const myHalf=Math.floor(spS/2);
          const theirHalf=Math.floor(cS/2);
          detail.score=myHalf-theirHalf;
          res.score+=detail.score;
          detail.notes.push(`好朋友：我方得 +${myHalf}分，對方得 -${theirHalf}分`);
        } else if (surroundEats) {
          // 只有對方能吃我，好朋友保護後對方只得一半
          const half=Math.floor(cS/2);
          detail.score=-half;
          res.score-=half;
          detail.notes.push(`好朋友保護：對方只得 -${half}分（原本 -${cS}）`);
        } else if (centerEats) {
          // 只有我能吃對方，好朋友保護後我只得一半
          const half=Math.floor(spS/2);
          detail.score=half;
          res.score+=half;
          detail.notes.push(`好朋友保護：我方只得 +${half}分（原本 +${spS}）`);
        } else {
          detail.score=0;
          detail.notes.push("好朋友，雙方無法直接交流：±0分");
        }
      } else {
        detail.score=0;
        detail.notes.push("好朋友（同陣）：互相支持");
      }
      detail.notes.push("✦ 一對好朋友");
      if (tp(sp)==="砲包") res.specials.push("💫 砲好朋友：感情相互欣賞，砲友美感");
      if (tp(sp)==="士仕"&&!isOwn) res.specials.push("✦ 士好朋友：彼此欣賞，特殊親密關係");
      res.details.push(detail); continue;
    }

    // === 一般計算 ===
    // 被吃的棋子有好朋友 → 吃牠的人只得一半
    // 周圍棋子的好朋友判斷：
    // - 一般棋子：只能是中間本命（周圍互不相鄰）
    // - 馬：好朋友需要日字位置，周圍的馬可以和另一個周圍位置的馬配對
    // - 砲：需要隔子對面有同類異色
    let spHasFriend = false;
    if(tp(sp)==="馬"){
      // 馬的好朋友：另一個周圍位置的異色馬，且兩者位置構成日字
      const horsePairs={left:["top","bottom"],right:["top","bottom"],top:["left","right"],bottom:["left","right"]};
      const pairPositions=horsePairs[pos]||[];
      spHasFriend=pairPositions.some(p2=>{
        const p2piece=pieces[p2];
        return p2piece && same(p2piece,sp) && diff(p2piece,sp);
      });
    } else if(tp(sp)==="砲包"){
      // 砲的好朋友：對面隔子有同類異色
      const oppPos={top:"bottom",bottom:"top",left:"right",right:"left"}[pos];
      const oppPiece=pieces[oppPos];
      spHasFriend=!!(oppPiece && same(oppPiece,sp) && diff(oppPiece,sp));
    } else {
      // 其他棋子：只有中間本命才能是好朋友
      spHasFriend = same(center,sp) && diff(center,sp) && tp(sp)!=="馬" && tp(sp)!=="砲包";
    }

    // 一枝獨秀：對方只有1枚棋子
    const oppPieces=SURROUND.filter(p=>pieces[p]&&col(pieces[p])!==selfColor);
    const isYiZhiDuXiu=oppPieces.length===1 && oppPieces[0]===pos;

    if(isYiZhiDuXiu){
      // 一枝獨秀：對方唯一子
      // 保護邏輯：唯一子保護自己不被完整吃掉（我方吃它只得一半）
      // 但它吃我方本命是完整分數，不受保護影響

      // 特殊：對方唯一子是上方卒/兵 → 雙方無交集
      if(pos==="top" && tp(sp)==="卒兵"){
        detail.score=0;
        detail.notes.push("一枝獨秀（上方卒/兵）：雙方無交集，互不影響：±0分");
        res.specials.push("☝️ 一枝獨秀：對方唯一子在上方且為卒/兵，雙方無交集，對方不甩你也不吃你");
        res.details.push(detail); continue;
      }

      // 中間是包或馬：困住無法主動攻擊
      const centerTrapped=(tp(center)==="砲包"||tp(center)==="馬");

      let myGain=0, theirGain=0;

      if(!centerTrapped && centerEats){
        // 我方能吃對方，但一枝獨秀保護→只得一半
        myGain=Math.floor(sc(sp)/2);
        detail.notes.push(`一枝獨秀保護：我方吃${d(sp)}只得 +${myGain}分（原本+${sc(sp)}）`);
      } else if(centerTrapped){
        detail.notes.push(`中間${d(center)}困住，無法攻擊：+0分`);
      }

      if(surroundEats){
        // 對方吃我方本命：完整分數，一枝獨秀不保護自己以外的棋子
        theirGain=sc(center);
        detail.notes.push(`對方（${d(sp)}）吃本命：-${theirGain}分（一枝獨秀不影響吃人能力）`);
      }

      detail.score=myGain-theirGain;
      res.score+=detail.score;

      res.specials.push(`☝️ 一枝獨秀：對方只有${d(sp)}一子，陰陽失衡，對方主導權大，你只能聽對方的`);
      res.warnings.push({type:"warning",text:`⚠️ 一枝獨秀：對方唯一子不會被你完整吃掉（只得一半），但它吃你是完整分數`});
      res.details.push(detail); continue;
    }

    if (!isOwn && centerEats && surroundEats) {
      // 雙方都能互吃
      const spS=sc(sp);
      const cS=sc(center);
      const myGain = spHasFriend ? Math.floor(spS/2) : spS; // 對方有好朋友→我只得一半
      const theirGain = hasFriend ? Math.floor(cS/2) : cS;  // 我有好朋友→對方只得一半
      detail.score=myGain-theirGain;
      res.score+=detail.score;
      const myNote = spHasFriend ? `我方吃${d(sp)}：+${myGain}分（好朋友保護，原本+${spS}）` : `我方吃${d(sp)}：+${myGain}分`;
      const theirNote = hasFriend ? `對方（${d(sp)}）吃本命：-${theirGain}分（好朋友保護，原本-${cS}）` : `對方（${d(sp)}）吃本命：-${theirGain}分`;
      detail.notes.push(myNote);
      detail.notes.push(theirNote);
      if (myGain>0) res.relations.push(`${posInfo?.desc}（${d(sp)}）是你的貴人，可積極經營`);

    } else if (!isOwn && centerEats) {
      // 我方中間吃對方，若對方有好朋友保護→只得一半
      const spS=sc(sp);
      if (tp(sp)==="將帥"&&tp(center)==="卒兵") {
        // 明君格：不受好朋友影響
        const gainSol=Math.floor(sc(center)/2);
        detail.score=gainSol;
        res.score+=gainSol;
        detail.notes.push(`明君格！卒/兵得 +${gainSol}分，將/帥得 +${Math.floor(spS/2)}分（對方）`);
        res.specials.push("✦ 明君格：將帥得兵卒輔佐，化暴君為明君");
      } else {
        const myGain = spHasFriend ? Math.floor(spS/2) : spS;
        detail.score=myGain;
        res.score+=myGain;
        if (spHasFriend) {
          detail.notes.push(`我方吃${d(sp)}：+${myGain}分（好朋友保護，原本+${spS}）`);
        } else {
          detail.notes.push(`我方吃${d(sp)}：+${myGain}分`);
        }
        if (tp(center)==="砲包"&&tp(sp)==="士仕")
          res.specials.push(qtype==="love"?"❤ 包吃士：感情正緣！":"✦ 包吃士：正緣能量");
        if (tp(center)==="砲包"&&tp(sp)!=="士仕")
          res.warnings.push({type:"warning",text:`⚠️ 包吃${d(sp)}：留意卡到陰`});
      }
      res.relations.push(`${posInfo?.desc}（${d(sp)}）是你的貴人，可積極經營`);

    } else if (!isOwn && surroundEats) {
      // 對方吃本命，若本命有好朋友保護則只得一半
      const cS=sc(center);
      const theirGain=hasFriend ? Math.floor(cS/2) : cS;
      detail.score=-theirGain;
      res.score-=theirGain;
      if (hasFriend) {
        detail.notes.push(`對方（${d(sp)}）吃本命：-${theirGain}分（好朋友保護，原本-${cS}）`);
      } else {
        detail.notes.push(`對方（${d(sp)}）吃本命：-${theirGain}分`);
      }

    } else if (!isOwn) {
      // 雙方吃不到
      detail.score=0;
      // 上方的卒兵特別說明：無所作為
      if (pos==="top" && tp(sp)==="卒兵") {
        detail.notes.push("上方卒/兵：上方出界、無左右位置、不能往下 → 無所作為：±0分");
      } else {
        detail.notes.push(`雙方無法直接交流：±0分`);
      }

    } else {
      // 同陣棋子
      detail.score=0;
      if (pos==="top" && tp(sp)==="卒兵") {
        detail.notes.push("上方卒/兵（同陣）：無所作為：±0分");
      } else {
        detail.notes.push("同陣棋子：±0分");
      }
    }

    res.details.push(detail);
  }

  // ---- 馬的跨格攻擊計算 ----
  for (const attackerPos of SURROUND) {
    const attacker=pieces[attackerPos];
    if (!attacker||tp(attacker)!=="馬") continue;
    const attackerColor=col(attacker);
    const targets=horseAttackPositions(attackerPos);
    const attackerInfo=POSITIONS.find(p=>p.key===attackerPos);

    for (const victimPos of targets) {
      const victim=pieces[victimPos];
      if (!victim) continue;
      const victimColor=col(victim);
      const victimInfo=POSITIONS.find(p=>p.key===victimPos);

      if (attackerColor===selfColor && victimColor!==selfColor) {
        // 判斷victim（被吃方）是否有好朋友保護
        let victimHasFriend=false;
        if(tp(victim)==="馬"){
          // 馬的好朋友：另一個周圍位置的異色馬，日字配對
          const horsePairs={left:["top","bottom"],right:["top","bottom"],top:["left","right"],bottom:["left","right"]};
          const pairPositions=horsePairs[victimPos]||[];
          victimHasFriend=pairPositions.some(p2=>{
            if(p2===attackerPos) return false; // 攻擊者本身不算
            const p2piece=pieces[p2];
            return p2piece && same(p2piece,victim) && diff(p2piece,victim);
          });
          // 也檢查中間本命是否是馬的好朋友
          if(!victimHasFriend && same(center,victim) && diff(center,victim)){
            victimHasFriend=true;
          }
        } else {
          // 其他棋子：中間本命是好朋友
          victimHasFriend = same(center,victim) && diff(center,victim) && tp(victim)!=="砲包";
        }
        const vS=sc(victim);
        const gain=victimHasFriend ? Math.floor(vS/2) : vS;
        res.score+=gain;
        res.crossAttacks.push({type:"gain", score:gain, text:`${attackerInfo?.label}（${d(attacker)}）走日字吃${victimInfo?.label}（${d(victim)}）：+${gain}分${victimHasFriend?"（好朋友保護，原本+"+vS+"）":""}`});
        res.relations.push(`${victimInfo?.desc}（${d(victim)}）被我方馬攻擊，可積極經營`);
      } else if (attackerColor!==selfColor && victimColor===selfColor) {
        // 對方馬吃我方棋子，若我方棋子有好朋友保護→只失一半
        let victimHasFriend=false;
        if(tp(victim)==="馬"){
          const horsePairs={left:["top","bottom"],right:["top","bottom"],top:["left","right"],bottom:["left","right"]};
          const pairPositions=horsePairs[victimPos]||[];
          victimHasFriend=pairPositions.some(p2=>{
            if(p2===attackerPos) return false;
            const p2piece=pieces[p2];
            return p2piece && same(p2piece,victim) && diff(p2piece,victim);
          });
          if(!victimHasFriend && same(center,victim) && diff(center,victim)){
            victimHasFriend=true;
          }
        } else {
          victimHasFriend = same(center,victim) && diff(center,victim) && tp(victim)!=="砲包";
        }
        const vS=sc(victim);
        const loss=victimHasFriend ? Math.floor(vS/2) : vS;
        res.score-=loss;
        res.crossAttacks.push({type:"loss", score:-loss, text:`${attackerInfo?.label}（${d(attacker)}）走日字吃${victimInfo?.label}（${d(victim)}）：-${loss}分${victimHasFriend?"（好朋友保護，原本-"+vS+"）":""}`});
      }
    }
  }

  // ---- 砲的跨格攻擊計算 ----
  const OPP={top:"bottom",bottom:"top",left:"right",right:"left"};
  for (const attackerPos of SURROUND) {
    const attacker=pieces[attackerPos];
    if (!attacker||tp(attacker)!=="砲包") continue;
    const attackerColor=col(attacker);
    const attackerInfo=POSITIONS.find(p=>p.key===attackerPos);
    const oppPos=OPP[attackerPos];
    const victim=pieces[oppPos];
    if (!victim) continue;
    const victimColor=col(victim);
    const victimInfo=POSITIONS.find(p=>p.key===oppPos);

    if (attackerColor!==selfColor && victimColor===selfColor) {
      const vS=sc(victim);
      res.score-=vS;
      res.crossAttacks.push({type:"loss", score:-vS, text:`${attackerInfo?.label}（${d(attacker)}）隔中間吃${victimInfo?.label}（${d(victim)}）：-${vS}分`});
      res.warnings.push({type:"warning", text:`⚠️ ${attackerInfo?.label}（${d(attacker)}）是變數！對方先動可吃${victimInfo?.label}損失-${vS}分，但你先吃砲可得+${sc(attacker)}分`});
    } else if (attackerColor===selfColor && victimColor!==selfColor) {
      const vS=sc(victim);
      res.score+=vS;
      res.crossAttacks.push({type:"gain", score:vS, text:`${attackerInfo?.label}（${d(attacker)}）隔中間吃${victimInfo?.label}（${d(victim)}）：+${vS}分`});
    }
  }

  // ---- 特殊格局 ----
  const all=Object.values(pieces).filter(Boolean);
  const cp=pieces.center;

  // 消耗格（同色同字在中間與周圍）
  for (const pos of SURROUND) {
    const sp=pieces[pos];
    if (sp&&cp&&same(sp,cp)&&!diff(sp,cp))
      res.specials.push(`${col(sp)===selfColor?"自身":"對方"}消耗格（${d(sp)}）：${getConsumeTrait(sp)}`);
  }

  // 眾星拱月（中間被全部異色包圍）
  const surroundCount=SURROUND.filter(pos=>!!pieces[pos]).length;
  const allOpposite=surroundCount>0 && SURROUND.filter(pos=>!!pieces[pos]).every(pos=>col(pieces[pos])!==selfColor);
  if(allOpposite && surroundCount>=3)
    res.specials.push("🌟 眾星拱月：四方皆為對方棋子圍繞，本命受眾人矚目，此事以你為主導，無論事業或感情皆以你為核心，不易被完全壓制");

  // 同色士
  const shiSelf=all.filter(p=>tp(p)==="士仕"&&col(p)===selfColor);
  if (shiSelf.length>=2)
    res.warnings.push({type:"info",text:"⚠️ 兩士同色同場：注意過於自負，能力強但易固執己見"});

  // 將帥暴動
  if (cp&&tp(cp)==="將帥") {
    res.specials.push("⚡ 將帥在中：掌權者，容易暴動，情緒起伏大，需留意饒人留餘地");
    let fc=0; for(const pos of SURROUND){if(isFriend(cp,pieces[pos],pos,pieces))fc++;}
    if(fc>1) res.warnings.push({type:"warning",text:"⚡ 將帥周圍好朋友越多越爆炸！情緒管理更要注意"});
    // 明君格提示
    const hasBing=SURROUND.some(pos=>pieces[pos]&&tp(pieces[pos])==="卒兵"&&col(pieces[pos])!==selfColor);
    if(hasBing) res.specials.push("✦ 明君格：得兵卒輔佐，暴君化明君，有智囊協助決策");
  }

  // 富貴格（將/帥 + 士/仕 + 象/相 同時出現，同色異色皆可）
  const hasGen=all.some(p=>tp(p)==="將帥");
  const hasShi=all.some(p=>tp(p)==="士仕");
  const hasXiang=all.some(p=>tp(p)==="象相");
  if(hasGen && hasShi && hasXiang){
    // 找到各棋子的位置
    const posWeight={top:3,left:2,right:2,center:1,bottom:0}; // 越高分越好
    let genPos=null,shiPos=null,xiangPos=null;
    for(const pos of ["center","top","bottom","left","right"]){
      const p=pieces[pos];
      if(!p) continue;
      if(tp(p)==="將帥"&&!genPos) genPos=pos;
      else if(tp(p)==="士仕"&&!shiPos) shiPos=pos;
      else if(tp(p)==="象相"&&!xiangPos) xiangPos=pos;
    }
    const genW=posWeight[genPos]??1;
    const shiW=posWeight[shiPos]??1;
    const xiangW=posWeight[xiangPos]??1;

    let trend="";
    if(xiangW>shiW&&shiW>genW) trend="📈 走勢：低開高走，越做越好，後勢看漲！";
    else if(xiangW>genW&&genW>=shiW) trend="📈 走勢：整體向好，結果優於開始";
    else if(genW>shiW&&shiW>xiangW) trend="📉 走勢：高開低走，後勢稍疲，但整體仍屬富貴格";
    else if(genW>xiangW&&xiangW>=shiW) trend="📉 走勢：開局較強，結果略顯疲弱，注意收尾";
    else trend="➡️ 走勢：平穩發展，無明顯高低起伏";

    const scoreHint=res.score!==null
      ? (res.score>0?"✅ 得分為正，強烈建議執行！":"❌ 得分為負，建議放棄，否則可能越陷越深，損失擴大")
      : "";

    res.specials.push(`👑 富貴格：此事有人協助，容易獲利，整體格局良好\n${trend}\n⚠️ 注意：富貴格不代表必然有收穫，仍需看得分決策\n${scoreHint}`);
  }

  // 事業格（車/俥 + 馬 + 砲/包 同時出現，同色異色皆可）
  const hasCar2=all.some(p=>tp(p)==="車俥");
  const hasHorse=all.some(p=>tp(p)==="馬");
  const hasCannon=all.some(p=>tp(p)==="砲包");
  if(hasCar2 && hasHorse && hasCannon){
    const posWeight={top:3,left:2,right:2,center:1,bottom:0};
    let carPos=null,horsePos=null,cannonPos=null;
    for(const pos of ["center","top","bottom","left","right"]){
      const p=pieces[pos];
      if(!p) continue;
      if(tp(p)==="車俥"&&!carPos) carPos=pos;
      else if(tp(p)==="馬"&&!horsePos) horsePos=pos;
      else if(tp(p)==="砲包"&&!cannonPos) cannonPos=pos;
    }
    const carW=posWeight[carPos]??1;
    const horseW=posWeight[horsePos]??1;
    const cannonW=posWeight[cannonPos]??1;

    let trend="";
    if(cannonW>horseW&&horseW>carW) trend="📈 走勢：低開高走，越做越好，後勢看漲！";
    else if(cannonW>carW&&carW>=horseW) trend="📈 走勢：整體向好，結果優於開始";
    else if(carW>horseW&&horseW>cannonW) trend="📉 走勢：高開低走，後勢稍疲，注意收尾";
    else if(carW>cannonW&&cannonW>=horseW) trend="📉 走勢：開局較強，結果略顯疲弱，審慎經營";
    else trend="➡️ 走勢：平穩發展，穩健經營";

    const scoreHint=res.score!==null
      ? (res.score>0?"✅ 得分為正，強烈建議全力投入！":"❌ 得分為負，建議放棄，否則越投入損失越大")
      : "";

    res.specials.push(`⚔️ 事業格：無論感情或事業，你會認真用心經營此事\n${trend}\n⚠️ 注意：事業格不代表必然成功，仍需看得分決策\n${scoreHint}`);
  }

  // 三人同心格（同色卒或兵出現3枚以上，一局5枚故只有單方能觸發）
  const selfSoldiers=all.filter(p=>tp(p)==="卒兵"&&col(p)===selfColor);
  const oppSoldiers=all.filter(p=>tp(p)==="卒兵"&&col(p)!==selfColor);
  if(selfSoldiers.length>=3){
    res.specials.push("👥 三人同心（我方）：你已充分準備好，團隊齊心，萬事俱備，可以放手去做！");
  } else if(oppSoldiers.length>=3){
    res.specials.push("👥 三人同心（對方）：市場或對方已準備好，需把握時機主動出擊，否則機會可能轉瞬即逝");
  }

  // 全卒兵
  if (all.every(p=>tp(p)==="卒兵"))
    res.specials.push("👑 五枚全卒兵：皇帝命！踏實中自帶王者氣場，做什麼都能穩健成功");

  // 毀橫格（全黑或全紅）
  const allBlack=all.every(p=>col(p)==="black");
  const allRed=all.every(p=>col(p)==="red");
  if (allBlack||allRed)
    res.warnings.push({type:"warning",text:"⚠️ 毀橫格：全"+(allBlack?"黑":"紅")+"無陰陽，能量無法完整流動，想做的事較難成局，建議另擇時機"});

  // 十字格：橫（左中右同色）且上下是異色，或豎（上中下同色）且左右是異色
  const centerColor=col(cp);
  const horiSame = cp && pieces.left && pieces.right &&
    col(pieces.left)===centerColor && col(pieces.right)===centerColor &&
    (!pieces.top || col(pieces.top)!==centerColor) &&
    (!pieces.bottom || col(pieces.bottom)!==centerColor);
  const vertSame = cp && pieces.top && pieces.bottom &&
    col(pieces.top)===centerColor && col(pieces.bottom)===centerColor &&
    (!pieces.left || col(pieces.left)!==centerColor) &&
    (!pieces.right || col(pieces.right)!==centerColor);
  if (horiSame||vertSame)
    res.specials.push("✙ 十字格：天柱加持，老天幫忙，有一種冥冥中引導的力量");

  // 分開格（同類異色上下或左右分開）
  const OPP2={top:"bottom",bottom:"top",left:"right",right:"left"};
  const checked=new Set();
  for(const pos of SURROUND){
    if(checked.has(pos)) continue;
    const sp=pieces[pos];
    if(!sp) continue;
    const oppPos=OPP2[pos];
    const op=pieces[oppPos];
    if(!op) continue;
    if(same(sp,op)&&diff(sp,op)){
      checked.add(pos); checked.add(oppPos);
      const isLR=(pos==="left"||pos==="right");
      const isUD=(pos==="top"||pos==="bottom");
      if(isLR) res.specials.push(`💔 分開格（${d(sp)}/${d(op)}左右相對）：與另一半或異性平輩緣分較淺，聚少離多，保持距離反而更好`);
      if(isUD) res.specials.push(`💔 分開格（${d(sp)}/${d(op)}上下相對）：與長輩晚輩緣分較淺，意見容易不同，保持適當距離`);
    }
  }

  // 兵卒隔中間分開格（兵卒上下，中間隔一子）
  // 例：上方是兵/卒，中間有本命，下方是卒/兵
  const topP=pieces.top, botP=pieces.bottom;
  if(topP && botP && cp &&
     tp(topP)==="卒兵" && tp(botP)==="卒兵" &&
     diff(topP,botP)){
    res.specials.push(`💔 兵卒隔中分開（${d(topP)}在上/${d(botP)}在下）：你與對方思想相反或沒有交集，難以合作共事，意見南轅北轍`);
  }
  // 左右也可能有隔中分開
  const leftP=pieces.left, rightP=pieces.right;
  if(leftP && rightP && cp &&
     tp(leftP)==="卒兵" && tp(rightP)==="卒兵" &&
     diff(leftP,rightP)){
    res.specials.push(`💔 兵卒隔中分開（${d(leftP)}在左/${d(rightP)}在右）：你與對方思想相反或沒有交集，難以合作共事`);
  }

  // 連續同色超過5支
  const colorCounts={black:all.filter(p=>col(p)==="black").length, red:all.filter(p=>col(p)==="red").length};
  if(colorCounts.black>=5||colorCounts.red>=5)
    res.warnings.push({type:"warning",text:`⚠️ 同色偏多（${colorCounts.black>=5?"黑":"紅"}色${colorCounts.black>=5?colorCounts.black:colorCounts.red}枚）：陰陽不協調，整體健康能量較弱，建議多補充能量`});

  // 五行缺失分析
  const hasEarth=all.some(p=>tp(p)==="卒兵");
  const hasFire=all.some(p=>tp(p)==="象相");
  const hasWater=all.some(p=>tp(p)==="砲包");
  const hasWood=all.some(p=>tp(p)==="馬");
  const hasMetal=all.some(p=>tp(p)==="車俥"||tp(p)==="士仕");
  const missing=[];
  if(!hasEarth) missing.push("土（卒兵）→ 腸胃道較弱");
  if(!hasFire)  missing.push("火（象相）→ 心血管較弱");
  if(!hasWater) missing.push("水（砲包）→ 腎臟較弱");
  if(!hasWood)  missing.push("木（馬）→ 關節經絡較弱");
  if(!hasMetal) missing.push("金（車/士）→ 支氣管較弱");
  if(missing.length>0)
    res.specials.push("🩺 缺五行："+missing.join("；"));

  // 好朋友情感特質補充
  for(const pos of SURROUND){
    const sp=pieces[pos];
    if(!sp||col(sp)===selfColor) continue;
    if(isFriend(cp,sp,pos,pieces)){
      const t=tp(sp);
      let trait="";
      if(t==="卒兵") trait="務實踏實，老夫老妻型感情";
      if(t==="馬")   trait="浪漫激情，桃花旺盛";
      if(t==="車俥") trait="各有主見，互相欣賞";
      if(t==="象相") trait="靈性修行，心靈伴侶";
      if(t==="士仕") trait="才智相惜，共同成長";
      if(t==="將帥") trait="強強聯手，偶有爭執但彼此尊重";
      if(t==="砲包") trait="美感相惜，容易砲友關係";
      if(trait&&qtype==="love") res.specials.push(`💑 好朋友情感（${d(sp)}）：${trait}`);
    }
  }

  // 砲位置靈性/事業解讀
  if(cp&&tp(cp)==="砲包"){
    if(qtype==="love") res.specials.push("💫 砲在中：感情上容易形成砲友關係，相互欣賞但難定性");
    if(qtype==="career") res.specials.push("🎨 砲在中：工作上有美感與創意天分，適合美學相關領域");
  }
  for(const pos of SURROUND){
    const sp=pieces[pos];
    if(!sp||col(sp)===selfColor) continue;
    if(tp(sp)==="砲包"){
      if(pos==="top") res.warnings.push({type:"warning",text:"⚠️ 上方有對方砲：留意小人問題，對方可能隨時成為變數"});
      if(pos==="bottom") res.warnings.push({type:"warning",text:"⚠️ 下方有對方砲：留意卡到陰的可能，注意身心能量"});
    }
  }

  // 包/馬在中間困住格提示
  if(cp && tp(cp)==="砲包"){
    const hasOppFacing=SURROUND.some(pos=>{
      const sp=pieces[pos];
      if(!sp||col(sp)===selfColor) return false;
      const opp={top:"bottom",bottom:"top",left:"right",right:"left"}[pos];
      return !!pieces[opp];
    });
    if(!hasOppFacing && !canFightBack){
      res.warnings.push({type:"warning",text:"🔒 困住格：中間砲/包需要隔子才能發威，目前無法攻擊任何對方棋子，得分能力受限"});
    }
  }
  if(cp && tp(cp)==="馬"){
    // 馬在中間永遠無法攻擊周圍四格
    if(!canFightBack){
      res.warnings.push({type:"warning",text:"🔒 困住格：中間馬走日字無法攻擊周圍四格，得分能力受限"});
    }
  }

  // 馬在中解讀補充
  if(cp&&tp(cp)==="馬")
    res.specials.push("🐴 馬在中：天馬行空，創意豐富，在外時間多於在家，心太軟容易為人付出");

  // 問事判斷邏輯提示
  const myTotal=res.score;
  if(myTotal!==null){
    if(isYiZhiDuXiuGlobal){
      // 一枝獨秀：以對方動向為主
      if(myTotal>0)
        res.specials.push("☝️ 問事判斷：一枝獨秀局，雖有小獲利，但以對方動向為主，靜待對方出手再跟進");
      else if(myTotal===0)
        res.specials.push("☝️ 問事判斷：一枝獨秀局，此事完全以對方為主導，你只能配合對方節奏");
      else
        res.specials.push("☝️ 問事判斷：一枝獨秀局，對方主導，目前局勢對你不利，建議觀望等待時機");
    } else if(myTotal>=60)
      res.specials.push("✅ 問事判斷：我方優勢明顯，只要主動出擊幾乎一定能成");
    else if(myTotal>0)
      res.specials.push("⚡ 問事判斷：有一定勝算，但需積極爭取，主動出擊可得利");
    else if(myTotal===0)
      res.specials.push("⚖️ 問事判斷：勢均力敵，誰先主動誰得利，把握時機出手");
    else
      res.specials.push("⚠️ 問事判斷：目前局勢不利，建議暫緩或調整策略再行動");
  }

  return res;
}

function getVerdict(score) {
  if (score===null) return {label:"極凶",color:"#ff2244",desc:"此局不宜，建議重新起卦"};
  if (score>=100)   return {label:"大吉",color:"#f0a500",desc:"形勢極佳，放手去做"};
  if (score>=50)    return {label:"吉",  color:"#4db87a",desc:"整體有利，積極行動"};
  if (score>=10)    return {label:"小吉",color:"#7ec8a0",desc:"稍有獲利，謹慎前行"};
  if (score>=0)     return {label:"平",  color:"#aaaaaa",desc:"付出與收穫相當"};
  if (score>=-30)   return {label:"小凶",color:"#e07b54",desc:"略有損失，留意周圍"};
  return              {label:"凶",  color:"#ff2244",desc:"損失較大，暫緩行動"};
}

// 老師模式密碼
const TEACHER_PWD="888888";

// ===== UI =====
const S={
  bg:"#080812", bg2:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
  gold:"#f0d060", red:"#ff8888", blue:"#88aaff", green:"#4db87a", muted:"#aaa",
  font:"'Noto Serif TC', serif",
};

function Btn({children,onClick,variant="primary",style={},disabled=false}) {
  const base={padding:"13px 20px",borderRadius:8,fontSize:15,cursor:disabled?"not-allowed":"pointer",
    letterSpacing:2,fontFamily:S.font,border:"none",width:"100%",opacity:disabled?0.4:1};
  const v={
    primary:{background:"rgba(240,208,96,0.15)",border:"1px solid rgba(240,208,96,0.4)",color:S.gold},
    secondary:{background:S.bg2,border:S.border,color:"#aaa"},
    ghost:{background:"none",border:"none",color:"#888",padding:"8px 12px"},
    danger:{background:"rgba(255,34,68,0.15)",border:"1px solid rgba(255,34,68,0.3)",color:"#ff6677"},
  };
  return <button onClick={disabled?undefined:onClick} style={{...base,...v[variant],...style}}>{children}</button>;
}

function Board({pieces,selfColor}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gridTemplateRows:"auto auto auto",gap:10,justifyItems:"center",margin:"16px 0"}}>
      {POSITIONS.map(pos=>{
        const p=pieces[pos.key];
        const pc=p?col(p):null;
        const isOwn=pc===selfColor;
        return (
          <div key={pos.key} style={{gridColumn:pos.gridCol,gridRow:pos.gridRow,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <div style={{fontSize:10,color:S.muted}}>{pos.desc}</div>
            <div style={{
              width:58,height:58,borderRadius:"50%",
              border:p?`2px solid ${isOwn?"rgba(100,140,255,0.6)":"rgba(255,100,100,0.6)"}`:"2px dashed rgba(255,255,255,0.12)",
              background:p?(isOwn?"radial-gradient(circle,#1a3a6a,#0d1f3c)":"radial-gradient(circle,#6a1a1a,#3c0d0d)"):"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
              boxShadow:p?(isOwn?"0 0 10px rgba(80,120,255,0.25)":"0 0 10px rgba(255,80,80,0.25)"):"none",
            }}>
              {p?<span style={{fontSize:22,fontWeight:"bold",fontFamily:"serif",color:isOwn?S.blue:S.red}}>{d(p)}</span>
                :<span style={{color:"#2a2a3a",fontSize:18}}>　</span>}
              {pos.key==="center"&&<div style={{position:"absolute",top:-2,right:-2,width:14,height:14,borderRadius:"50%",background:S.gold,fontSize:7,display:"flex",alignItems:"center",justifyContent:"center",color:"#000",fontWeight:"bold"}}>主</div>}
            </div>
            <div style={{fontSize:12,color:p?"#ccc":"#333",fontWeight:"bold"}}>{pos.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 抽牌頁面 =====
function DrawPage({question,qtype,onBack,onDone}) {
  const [drawnList,setDrawnList]=useState([]); // 已抽的棋子陣列，按順序
  const [pool,setPool]=useState([...FULL_POOL]);
  const [flipping,setFlipping]=useState(false);
  const [lastDrawn,setLastDrawn]=useState(null);

  const step=drawnList.length; // 0~5
  const done=step>=5;

  // 從drawnList建立pieces和selfColor
  const pieces={center:null,left:null,right:null,top:null,bottom:null};
  drawnList.forEach((p,i)=>{ if(STEP_ORDER[i]) pieces[STEP_ORDER[i]]=p; });
  const selfColor=drawnList.length>0 ? col(drawnList[0]) : null;

  const currentPos=STEP_ORDER[step];
  const posInfo=POSITIONS.find(p=>p.key===currentPos);

  function drawPiece() {
    if(flipping||done) return;
    setFlipping(true);
    setLastDrawn(null);
    setTimeout(()=>{
      const idx=Math.floor(Math.random()*pool.length);
      const drawn=pool[idx];
      const newPool=[...pool.slice(0,idx),...pool.slice(idx+1)];
      setPool(newPool);
      setDrawnList(prev=>[...prev,drawn]);
      setLastDrawn(drawn);
      setFlipping(false);
    },400);
  }

  function goToResult() {
    const finalPieces={center:null,left:null,right:null,top:null,bottom:null};
    drawnList.forEach((p,i)=>{ if(STEP_ORDER[i]) finalPieces[STEP_ORDER[i]]=p; });
    const sc=drawnList.length>0 ? col(drawnList[0]) : null;
    onDone(finalPieces, sc);
  }

  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:440,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20}}>
          <Btn onClick={onBack} variant="ghost" style={{width:"auto"}}>← 返回</Btn>
          <h2 style={{fontSize:18,color:S.gold,margin:0}}>逐一抽取</h2>
        </div>

        <div style={{padding:"10px 14px",background:"rgba(240,208,96,0.07)",borderRadius:8,marginBottom:16,color:S.gold,fontSize:13}}>
          {QTYPES.find(q=>q.key===qtype)?.icon} {question}
        </div>

        <Board pieces={pieces} selfColor={selfColor}/>

        {!done?(
          <div style={{textAlign:"center"}}>
            <div style={{color:S.muted,fontSize:13,marginBottom:16}}>
              第 {step+1} 枚 → 放入「{posInfo?.label}」（{posInfo?.desc}）
            </div>

            {/* 翻牌按鈕 */}
            <div onClick={drawPiece} style={{
              width:100,height:100,borderRadius:"50%",margin:"0 auto 20px",
              background:flipping
                ?"rgba(240,208,96,0.3)"
                :"linear-gradient(135deg,rgba(240,208,96,0.2),rgba(240,208,96,0.05))",
              border:`2px solid ${flipping?"rgba(240,208,96,0.8)":"rgba(240,208,96,0.4)"}`,
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              cursor:flipping?"default":"pointer",
              transition:"all 0.3s",
              boxShadow:flipping?"0 0 24px rgba(240,208,96,0.4)":"none",
              transform:flipping?"scale(0.92)":"scale(1)",
            }}>
              <div style={{fontSize:flipping?28:32,transition:"all 0.3s"}}>{flipping?"🔮":"♟"}</div>
              <div style={{fontSize:11,color:S.gold,marginTop:4,letterSpacing:1}}>{flipping?"翻牌中...":"點擊翻牌"}</div>
            </div>

            {lastDrawn&&(
              <div style={{
                display:"inline-block",padding:"10px 24px",borderRadius:20,
                background:col(lastDrawn)==="black"?"rgba(80,120,255,0.15)":"rgba(255,80,80,0.15)",
                border:`1px solid ${col(lastDrawn)==="black"?"rgba(80,120,255,0.4)":"rgba(255,80,80,0.4)"}`,
                color:col(lastDrawn)==="black"?S.blue:S.red,
                fontSize:18,fontWeight:"bold",fontFamily:"serif",letterSpacing:4,
              }}>
                {d(lastDrawn)} <span style={{fontSize:12,fontWeight:"normal",color:"#888"}}>{col(lastDrawn)==="black"?"黑":"紅"}</span>
              </div>
            )}

            <div style={{marginTop:16,color:"#aaa",fontSize:12}}>剩餘棋子池：{pool.length} 枚</div>
          </div>
        ):(
          <div style={{textAlign:"center",padding:20}}>
            <div style={{fontSize:20,color:S.gold,marginBottom:16,letterSpacing:2}}>五枚起卦完成</div>
            <Btn onClick={goToResult}>
              查看解盤 →
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 手動填入頁面 =====
function ManualPage({question,qtype,onBack,onDone}) {
  const [pieces,setPieces]=useState({center:null,left:null,right:null,top:null,bottom:null});
  const [selfColor,setSelfColor]=useState(null);
  const [selectingPos,setSelectingPos]=useState(null);

  function setPiece(pos,piece) {
    const np={...pieces,[pos]:piece};
    if (pos==="center"&&piece) setSelfColor(col(piece));
    setPieces(np);
    setSelectingPos(null);
  }

  const allFilled=STEP_ORDER.every(p=>!!pieces[p]);

  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:440,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20}}>
          <Btn onClick={onBack} variant="ghost" style={{width:"auto"}}>← 返回</Btn>
          <h2 style={{fontSize:18,color:S.gold,margin:0}}>手動填入（紀錄用）</h2>
        </div>

        <div style={{padding:"10px 14px",background:"rgba(240,208,96,0.07)",borderRadius:8,marginBottom:16,color:S.gold,fontSize:13}}>
          {question}
        </div>

        <Board pieces={pieces} selfColor={selfColor}/>

        <div style={{color:S.muted,textAlign:"center",fontSize:12,marginBottom:16}}>點擊下方位置按鈕，選擇對應棋子</div>

        {/* 位置選擇列 */}
        <div style={{display:"flex",gap:6,marginBottom:16,justifyContent:"center",flexWrap:"wrap"}}>
          {POSITIONS.map(pos=>{
            const p=pieces[pos.key];
            const pc=p?col(p):null;
            const isOwn=pc===selfColor;
            return (
              <button key={pos.key} onClick={()=>setSelectingPos(selectingPos===pos.key?null:pos.key)} style={{
                padding:"8px 12px",borderRadius:8,cursor:"pointer",fontFamily:S.font,
                border:selectingPos===pos.key?`1px solid ${S.gold}`:p?`1px solid ${isOwn?"rgba(100,140,255,0.4)":"rgba(255,100,100,0.4)"}`:S.border,
                background:selectingPos===pos.key?"rgba(240,208,96,0.12)":p?(isOwn?"rgba(80,120,255,0.1)":"rgba(255,80,80,0.1)"):S.bg2,
                color:selectingPos===pos.key?S.gold:p?(isOwn?S.blue:S.red):"#666",
                fontSize:13,minWidth:60,
              }}>
                {pos.label} {p?d(p):"—"}
              </button>
            );
          })}
        </div>

        {/* 棋子選擇盤 */}
        {selectingPos&&(
          <div style={{background:S.bg2,borderRadius:10,padding:16,marginBottom:16,border:S.border}}>
            <div style={{color:S.gold,fontSize:13,marginBottom:12}}>
              選擇「{POSITIONS.find(p=>p.key===selectingPos)?.label}—{POSITIONS.find(p=>p.key===selectingPos)?.desc}」的棋子：
            </div>
            <div style={{marginBottom:12}}>
              <div style={{color:"#6688aa",fontSize:12,marginBottom:8}}>黑方</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {BLACK_LIST.map(p=>(
                  <button key={p} onClick={()=>setPiece(selectingPos,p)} style={{
                    width:44,height:44,borderRadius:"50%",cursor:"pointer",fontFamily:"serif",
                    border:pieces[selectingPos]===p?"2px solid #88aaff":"2px solid rgba(255,255,255,0.12)",
                    background:pieces[selectingPos]===p?"rgba(80,120,255,0.3)":"rgba(20,20,60,0.4)",
                    color:S.blue,fontSize:16,fontWeight:"bold",
                  }}>{d(p)}</button>
                ))}
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{color:"#aa6666",fontSize:12,marginBottom:8}}>紅方</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {RED_LIST.map(p=>(
                  <button key={p} onClick={()=>setPiece(selectingPos,p)} style={{
                    width:44,height:44,borderRadius:"50%",cursor:"pointer",fontFamily:"serif",
                    border:pieces[selectingPos]===p?"2px solid #ff8888":"2px solid rgba(255,255,255,0.12)",
                    background:pieces[selectingPos]===p?"rgba(255,80,80,0.3)":"rgba(60,20,20,0.4)",
                    color:S.red,fontSize:16,fontWeight:"bold",
                  }}>{d(p)}</button>
                ))}
              </div>
            </div>
            {pieces[selectingPos]&&(
              <button onClick={()=>setPiece(selectingPos,null)} style={{padding:"4px 12px",background:"none",border:S.border,borderRadius:6,color:"#aaa",cursor:"pointer",fontSize:11}}>清除</button>
            )}
          </div>
        )}

        <Btn onClick={()=>{ if(!allFilled){alert("請填入全部5個位置的棋子");return;} onDone(pieces,selfColor); }} disabled={!allFilled}>
          {allFilled?"查看解盤 →":"請填入全部5枚棋子"}
        </Btn>
      </div>
    </div>
  );
}

// ===== 解盤頁面 =====
function ResultPage({question,qtype,pieces,selfColor,result,onReset,onSave,saveStatus}) {
  const [note,setNote]=useState("");
  const [aiReading,setAiReading]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [aiError,setAiError]=useState("");
  const v=getVerdict(result.score);

  // 組合送給AI的資料
  function buildPrompt() {
    const qtypeLabel=QTYPES.find(q=>q.key===qtype)?.label||"整體運勢";
    const boardDesc=STEP_ORDER.map(pos=>{
      const p=pieces[pos];
      if(!p) return null;
      const posInfo=POSITIONS.find(pp=>pp.key===pos);
      const isOwn=col(p)===selfColor;
      return `${posInfo?.label}（${posInfo?.desc}）：${d(p)}（${isOwn?"我方":"對方"}）`;
    }).filter(Boolean).join("、");

    const scoreDesc=result.score===null?"極凶（本命被通吃）":(result.score>0?`+${result.score}分`:`${result.score}分`);
    const verdictDesc=getVerdict(result.score).label;

    const specialsDesc=result.specials.length>0?result.specials.join("；"):"無特殊格局";
    const warningsDesc=result.warnings.length>0?result.warnings.map(w=>w.text).join("；"):"無警示";
    const relationsDesc=result.relations.length>0?result.relations.join("；"):"無";

    const detailsDesc=result.details.map(det=>{
      const scoreStr=det.score>0?`+${det.score}`:det.score<0?`${det.score}`:"±0";
      return `${det.label}（${d(det.piece)}）：${scoreStr}分`;
    }).join("、");

    const crossDesc=result.crossAttacks&&result.crossAttacks.length>0
      ?result.crossAttacks.map(ca=>ca.text).join("；"):"無";

    return `你是一位象棋占卜師，擅長用象棋棋局解讀人生運勢。請根據以下起卦結果，給出一段自然流暢、有深度的中文解盤建議。

【問題】${question}
【問事方向】${qtypeLabel}
【棋局】${boardDesc}
【總分】${scoreDesc}（${verdictDesc}）
【各方向得分】${detailsDesc}
【跨格攻擊】${crossDesc}
【特殊格局】${specialsDesc}
【警示】${warningsDesc}
【貴人方向】${relationsDesc}

請綜合以上資訊，用200~300字給出解盤，要：
1. 結合問題內容給出具體建議
2. 說明格局對這件事的影響
3. 指出貴人方向和需要注意的事
4. 最後給出明確的行動建議
語氣要溫和專業，像老師在面對面解盤。`;
  }

  async function handleAIReading() {
    setAiLoading(true);
    setAiError("");
    setAiReading("");
    try {
      const aiConfig = await loadAIConfig();
      const response = await fetch("/api/ai-reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(),
          provider: aiConfig.provider || "deepseek"
        })
      });
      const data = await response.json();
      if(data.error) throw new Error(data.error);
      setAiReading(data.text || "無法取得解盤");
    } catch(e) {
      setAiError("AI解盤失敗："+e.message);
    }
    setAiLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:440,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20}}>
          <Btn onClick={onReset} variant="ghost" style={{width:"auto"}}>← 重新</Btn>
          <h2 style={{fontSize:18,color:S.gold,margin:0}}>解盤結果</h2>
        </div>

        <div style={{padding:"10px 14px",background:"rgba(240,208,96,0.07)",borderRadius:8,marginBottom:16,color:"#ccc",fontSize:13}}>
          <span style={{color:S.gold}}>{QTYPES.find(q=>q.key===qtype)?.icon} {QTYPES.find(q=>q.key===qtype)?.label}</span>
          <br/>{question}
        </div>

        <Board pieces={pieces} selfColor={selfColor}/>

        {/* 總分 */}
        <div style={{textAlign:"center",padding:"20px 16px",borderRadius:12,marginBottom:16,border:`1px solid ${v.color}44`,background:`radial-gradient(ellipse,${v.color}0d,transparent)`}}>
          <div style={{fontSize:13,color:S.muted,marginBottom:4,letterSpacing:2}}>總分</div>
          <div style={{fontSize:56,fontWeight:"bold",color:v.color,lineHeight:1}}>
            {result.score!==null?(result.score>0?`+${result.score}`:result.score):"—"}
          </div>
          <div style={{fontSize:22,color:v.color,letterSpacing:4,margin:"6px 0 4px"}}>{v.label}</div>
          <div style={{color:"#bbb",fontSize:13}}>{v.desc}</div>
        </div>

        {/* 警告 */}
        {result.warnings.map((w,i)=>(
          <div key={i} style={{padding:"10px 14px",borderRadius:8,marginBottom:8,
            background:w.type==="danger"?"rgba(255,34,68,0.08)":"rgba(240,160,0,0.08)",
            border:`1px solid ${w.type==="danger"?"#ff224433":"#f0a00033"}`,
            color:w.type==="danger"?"#ff8888":"#f0c060",fontSize:13}}>
            {w.text}
          </div>
        ))}

        {/* 本命棋子 */}
        {pieces.center&&(
          <div style={{padding:"10px 14px",borderRadius:8,marginBottom:8,background:"rgba(240,208,96,0.05)",border:"1px solid rgba(240,208,96,0.12)"}}>
            <div style={{color:S.gold,fontSize:13,marginBottom:3}}>
              中（本命）：
              <span style={{fontFamily:"serif",fontSize:18,fontWeight:"bold",color:selfColor==="black"?S.blue:S.red,marginRight:6}}>{d(pieces.center)}</span>
              <span style={{color:selfColor==="black"?S.blue:S.red,fontSize:12}}>{selfColor==="black"?"黑方（自己）":"紅方（自己）"}</span>
            </div>
            <div style={{color:"#999",fontSize:12}}>{getPieceTrait(pieces.center)}</div>
          </div>
        )}

        {/* 各方向明細 */}
        <div style={{marginBottom:16}}>
          <div style={{color:"#aaa",fontSize:12,letterSpacing:2,marginBottom:8}}>各方向得分明細</div>
          {result.details.map((det,i)=>{
            const isOwnPiece=det.pieceColor===selfColor;
            const scoreColor=det.score>0?S.green:det.score<0?"#ff6655":"#888";
            return (
              <div key={i} style={{padding:"10px 14px",borderRadius:8,marginBottom:6,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div>
                    <span style={{color:"#bbb",fontSize:12}}>{det.label}（{det.relation}）</span>
                    <span style={{color:isOwnPiece?S.blue:S.red,fontSize:16,fontWeight:"bold",marginLeft:6,fontFamily:"serif"}}>{d(det.piece)}</span>
                    <span style={{color:"#bbb",fontSize:11,marginLeft:4}}>{isOwnPiece?"同陣":"對方"}</span>
                  </div>
                  <div style={{fontSize:20,fontWeight:"bold",color:scoreColor,minWidth:52,textAlign:"right"}}>
                    {det.score>0?`+${det.score}`:det.score<0?det.score:"±0"}
                  </div>
                </div>
                {det.notes.map((n,j)=>(
                  <div key={j} style={{color:"#aaa",fontSize:12,lineHeight:1.8,paddingLeft:4}}>{n}</div>
                ))}
              </div>
            );
          })}

          {/* 跨格攻擊（馬/砲）*/}
          {result.crossAttacks&&result.crossAttacks.length>0&&(
            <>
              <div style={{color:"#aaa",fontSize:12,letterSpacing:2,margin:"12px 0 8px"}}>跨格攻擊（馬走日字 / 砲飛越）</div>
              {result.crossAttacks.map((ca,i)=>{
                const scoreColor=ca.score>0?S.green:"#ff6655";
                return (
                  <div key={i} style={{padding:"10px 14px",borderRadius:8,marginBottom:6,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{color:"#bbb",fontSize:13}}>{ca.type==="gain"?"✦":"⚠️"} {ca.text.replace(/：[+-]\d+分.*/,"")}</span>
                      <span style={{fontSize:20,fontWeight:"bold",color:scoreColor,minWidth:52,textAlign:"right"}}>
                        {ca.score>0?`+${ca.score}`:ca.score}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* 計分合計列 */}
          {result.score!==null&&(
            <div style={{padding:"10px 14px",borderRadius:8,marginTop:8,background:"rgba(255,255,255,0.04)",border:`1px solid ${v.color}44`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#bbb",fontSize:13,letterSpacing:2}}>總計</span>
              <span style={{fontSize:22,fontWeight:"bold",color:v.color}}>{result.score>0?`+${result.score}`:result.score}</span>
            </div>
          )}
        </div>

        {/* 特殊格局（只放消耗/好朋友/富貴等格局解讀，不含得分）*/}
        {result.specials.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{color:"#aaa",fontSize:12,letterSpacing:2,marginBottom:8}}>格局解讀</div>
            {result.specials.map((s,i)=>(
              <div key={i} style={{padding:"8px 12px",borderRadius:6,marginBottom:6,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.1)",color:"#ccd",fontSize:13}}>{s}</div>
            ))}
          </div>
        )}

        {/* 貴人方向 */}
        {result.relations.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{color:"#aaa",fontSize:12,letterSpacing:2,marginBottom:8}}>貴人方向</div>
            {result.relations.map((r,i)=>(
              <div key={i} style={{padding:"8px 12px",borderRadius:6,marginBottom:6,background:"rgba(77,184,122,0.05)",border:"1px solid rgba(77,184,122,0.2)",color:"#7ed4a4",fontSize:12}}>✦ {r}</div>
            ))}
          </div>
        )}

        {/* AI 解盤 */}
        <div style={{marginBottom:16}}>
          <div style={{color:"#aaa",fontSize:12,letterSpacing:2,marginBottom:8}}>🤖 AI 解盤</div>
          {!aiReading&&!aiLoading&&(
            <Btn onClick={handleAIReading} variant="primary">
              ✨ 產生 AI 解盤
            </Btn>
          )}
          {aiLoading&&(
            <div style={{padding:"20px",textAlign:"center",background:S.bg2,borderRadius:8,border:S.border}}>
              <div style={{color:S.gold,fontSize:14,marginBottom:8}}>🔮 AI 正在解盤中...</div>
              <div style={{color:"#aaa",fontSize:12}}>綜合棋局與問題分析中，請稍候</div>
            </div>
          )}
          {aiError&&(
            <div style={{padding:"10px 14px",borderRadius:8,background:"rgba(255,34,68,0.08)",border:"1px solid #ff224433",color:"#ff8888",fontSize:13}}>
              {aiError}
            </div>
          )}
          {aiReading&&(
            <div style={{padding:"14px 16px",borderRadius:8,background:"rgba(240,208,96,0.05)",border:"1px solid rgba(240,208,96,0.2)"}}>
              <div style={{color:S.gold,fontSize:12,marginBottom:8,letterSpacing:1}}>✨ AI 解盤結果</div>
              <div style={{color:"#ddd",fontSize:14,lineHeight:1.9,whiteSpace:"pre-wrap"}}>{aiReading}</div>
              <button onClick={handleAIReading} style={{marginTop:12,padding:"6px 14px",background:"none",border:"1px solid rgba(240,208,96,0.3)",borderRadius:6,color:S.gold,fontSize:12,cursor:"pointer"}}>
                重新生成
              </button>
            </div>
          )}
        </div>

        {/* 備註 */}
        <div style={{marginBottom:16}}>
          <div style={{color:S.muted,fontSize:12,letterSpacing:2,marginBottom:8}}>備註（老師解讀補充）</div>
          <textarea value={note} onChange={e=>setNote(e.target.value)}
            placeholder="可記錄老師的補充說明或自己的心得..."
            style={{width:"100%",minHeight:80,padding:"12px 16px",background:S.bg2,border:S.border,borderRadius:8,color:"#fff",fontSize:13,resize:"vertical",fontFamily:S.font,boxSizing:"border-box"}}
          />
        </div>

        <div style={{display:"flex",gap:8,marginBottom:40}}>
          <Btn onClick={()=>onSave(note)} style={{flex:1}}>{saveStatus||"💾 儲存紀錄"}</Btn>
          <Btn onClick={onReset} variant="secondary" style={{flex:1}}>重新起卦</Btn>
        </div>
      </div>
    </div>
  );
}

// ===== 歷史紀錄 =====
function HistoryPage({records,onBack,isTeacher,onRecordsUpdate}) {
  const [expanded,setExpanded]=useState(null);
  const [editingNote,setEditingNote]=useState({});
  const [savingId,setSavingId]=useState(null);

  async function handleSaveNote(id) {
    setSavingId(id);
    const ok=await updateTeacherNote(id, editingNote[id]);
    if(ok) onRecordsUpdate();
    setSavingId(null);
  }

  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:480,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:24}}>
          <Btn onClick={onBack} variant="ghost" style={{width:"auto"}}>← 返回</Btn>
          <h2 style={{fontSize:18,color:S.gold,margin:0}}>歷史紀錄</h2>
          {isTeacher&&<span style={{marginLeft:"auto",padding:"4px 10px",background:"rgba(240,208,96,0.15)",border:"1px solid rgba(240,208,96,0.3)",borderRadius:20,fontSize:11,color:S.gold}}>老師模式</span>}
        </div>

        {records.length===0
          ?<div style={{textAlign:"center",color:"#aaa",marginTop:80,fontSize:14}}>尚無紀錄</div>
          :records.map(r=>{
            const v=getVerdict(r.score);
            const isOpen=expanded===r.id;
            const noteVal=editingNote[r.id]!==undefined?editingNote[r.id]:(r.teacherNote||"");
            return (
              <div key={r.id} style={{borderRadius:10,marginBottom:10,background:S.bg2,border:S.border,overflow:"hidden"}}>
                {/* 摘要列 */}
                <div onClick={()=>setExpanded(isOpen?null:r.id)}
                  style={{padding:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                      <span style={{color:"#999",fontSize:11}}>{r.date}</span>
                      <span style={{color:v.color,fontSize:13,fontWeight:"bold"}}>{v.label} {r.score!==null?(r.score>0?`+${r.score}`:r.score):"—"}</span>
                      {r.teacherNote&&<span style={{fontSize:10,color:S.gold}}>✦ 老師解盤</span>}
                    </div>
                    <div style={{color:"#ccc",fontSize:13,marginBottom:6}}>{r.question}</div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {STEP_ORDER.map(pos=>r.pieces?.[pos]&&(
                        <span key={pos} style={{padding:"2px 7px",borderRadius:10,fontSize:11,
                          background:col(r.pieces[pos])===r.selfColor?"rgba(80,120,255,0.12)":"rgba(255,80,80,0.12)",
                          color:col(r.pieces[pos])===r.selfColor?S.blue:S.red}}>
                          {POSITIONS.find(p=>p.key===pos)?.label}:{d(r.pieces[pos])}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span style={{color:"#aaa",fontSize:12,marginLeft:8}}>{isOpen?"▲":"▼"}</span>
                </div>

                {/* 展開內容 */}
                {isOpen&&(
                  <div style={{padding:"0 14px 14px",borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                    {/* 棋盤 */}
                    <div style={{margin:"12px 0"}}>
                      <Board pieces={r.pieces||{}} selfColor={r.selfColor}/>
                    </div>

                    {/* 用戶備註 */}
                    {r.note&&(
                      <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.02)",borderRadius:6,marginBottom:10,color:"#888",fontSize:12}}>
                        📝 用戶備註：{r.note}
                      </div>
                    )}

                    {/* 老師解盤區 */}
                    <div style={{marginBottom:8,color:"#aaa",fontSize:12,letterSpacing:1}}>
                      {isTeacher?"✏️ 老師解盤（可編輯）":"👨‍🏫 老師解盤"}
                    </div>
                    {isTeacher?(
                      <>
                        <textarea
                          value={noteVal}
                          onChange={e=>setEditingNote({...editingNote,[r.id]:e.target.value})}
                          placeholder="輸入老師解盤內容..."
                          style={{width:"100%",minHeight:100,padding:"10px 14px",background:"rgba(255,255,255,0.06)",
                            border:"1px solid rgba(240,208,96,0.3)",borderRadius:8,color:"#fff",fontSize:13,
                            resize:"vertical",fontFamily:S.font,boxSizing:"border-box",marginBottom:8}}
                        />
                        <Btn onClick={()=>handleSaveNote(r.id)} style={{marginTop:4}}>
                          {savingId===r.id?"儲存中...":"💾 儲存老師解盤"}
                        </Btn>
                      </>
                    ):(
                      <div style={{padding:"10px 14px",background:"rgba(240,208,96,0.05)",border:"1px solid rgba(240,208,96,0.12)",
                        borderRadius:8,color:r.teacherNote?"#f0d060":"#444",fontSize:13,minHeight:60}}>
                        {r.teacherNote||"（老師尚未填寫解盤）"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ===== 老師登入頁面 =====
function TeacherLoginPage({onLogin,onBack}) {
  const [pwd,setPwd]=useState("");
  const [err,setErr]=useState("");
  function tryLogin() {
    if(pwd===TEACHER_PWD){ onLogin(); }
    else { setErr("密碼錯誤"); }
  }
  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:"100%",maxWidth:320}}>
        <Btn onClick={onBack} variant="ghost" style={{width:"auto",marginBottom:24}}>← 返回</Btn>
        <h2 style={{fontSize:20,color:S.gold,marginBottom:24,textAlign:"center"}}>老師模式</h2>
        <input type="password" value={pwd} onChange={e=>{setPwd(e.target.value);setErr("");}}
          onKeyDown={e=>e.key==="Enter"&&tryLogin()}
          placeholder="請輸入老師密碼"
          style={{width:"100%",padding:"14px 16px",background:S.bg2,border:err?"1px solid #ff4466":S.border,
            borderRadius:8,color:"#fff",fontSize:15,fontFamily:S.font,boxSizing:"border-box",marginBottom:8}}
        />
        {err&&<div style={{color:"#ff6677",fontSize:13,marginBottom:8}}>{err}</div>}
        <Btn onClick={tryLogin}>進入老師模式</Btn>
      </div>
    </div>
  );
}

// ===== AI設定頁面 =====
function AISettingsPage({onBack}) {
  const [cfg,setCfg]=useState({provider:"deepseek",enabled:true,deepseekKey:""});
  const [saved,setSaved]=useState(false);
  useEffect(()=>{ loadAIConfig().then(setCfg); },[]);

  async function handleSave() {
    await saveAIConfig(cfg);
    setSaved(true);
    setTimeout(()=>setSaved(false),2000);
  }

  return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:440,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:28}}>
          <Btn onClick={onBack} variant="ghost" style={{width:"auto"}}>← 返回</Btn>
          <h2 style={{fontSize:18,color:S.gold,margin:0}}>AI 設定</h2>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{color:"#aaa",fontSize:13,marginBottom:10}}>AI 解盤功能</div>
          <div style={{display:"flex",gap:8}}>
            {[["true","開啟"],["false","關閉"]].map(([val,label])=>(
              <button key={val} onClick={()=>setCfg({...cfg,enabled:val==="true"})} style={{
                flex:1,padding:"12px",borderRadius:8,cursor:"pointer",fontFamily:S.font,
                border:String(cfg.enabled)===(val)?`1px solid ${S.gold}`:S.border,
                background:String(cfg.enabled)===(val)?"rgba(240,208,96,0.12)":S.bg2,
                color:String(cfg.enabled)===(val)?S.gold:"#777",fontSize:13,
              }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{color:"#aaa",fontSize:13,marginBottom:10}}>AI 供應商</div>
          <div style={{display:"flex",gap:8}}>
            {[["claude","Claude Haiku"],["deepseek","DeepSeek"]].map(([val,label])=>(
              <button key={val} onClick={()=>setCfg({...cfg,provider:val})} style={{
                flex:1,padding:"12px",borderRadius:8,cursor:"pointer",fontFamily:S.font,
                border:cfg.provider===val?`1px solid ${S.gold}`:S.border,
                background:cfg.provider===val?"rgba(240,208,96,0.12)":S.bg2,
                color:cfg.provider===val?S.gold:"#777",fontSize:13,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {cfg.provider==="deepseek"&&(
          <div style={{marginBottom:20}}>
            <div style={{color:"#aaa",fontSize:13,marginBottom:8}}>DeepSeek API Key</div>
            <input type="password" value={cfg.deepseekKey||""} onChange={e=>setCfg({...cfg,deepseekKey:e.target.value})}
              placeholder="sk-..."
              style={{width:"100%",padding:"12px 16px",background:S.bg2,border:S.border,borderRadius:8,
                color:"#fff",fontSize:13,fontFamily:S.font,boxSizing:"border-box"}}
            />
            <div style={{color:"#aaa",fontSize:11,marginTop:6}}>Claude 模式不需要填寫，由平台處理</div>
          </div>
        )}

        {cfg.provider==="claude"&&(
          <div style={{padding:"10px 14px",background:"rgba(80,120,255,0.08)",border:"1px solid rgba(80,120,255,0.2)",borderRadius:8,marginBottom:20,color:"#88aaff",fontSize:12}}>
            ✦ Claude 模式：使用 claude-haiku，費用由平台負擔，每次解盤約 0.1~0.3 元台幣
          </div>
        )}

        <Btn onClick={handleSave}>{saved?"✓ 已儲存":"儲存設定"}</Btn>
      </div>
    </div>
  );
}

// ===== 主程式 =====
export default function App() {
  const [page,setPage]=useState("home");
  const [qtype,setQtype]=useState("general");
  const [question,setQuestion]=useState("");
  const [inputMode,setInputMode]=useState("draw");
  const [selfColor,setSelfColor]=useState(null);
  const [pieces,setPieces]=useState({center:null,left:null,right:null,top:null,bottom:null});
  const [result,setResult]=useState(null);
  const [records,setRecords]=useState([]);
  const [saveStatus,setSaveStatus]=useState("");
  const [isTeacher,setIsTeacher]=useState(false);

  useEffect(()=>{
    loadRecords(isTeacher).then(setRecords);
    loadTeacherMode().then(setIsTeacher);
  },[]);

  function handleDone(newPieces,sc) {
    const safeSc = sc || col(newPieces.center);
    setPieces(newPieces);
    setSelfColor(safeSc);
    try {
      setResult(calculate(newPieces, safeSc, qtype));
    } catch(e) {
      console.error("calculate error:", e);
      setResult({score:0,details:[],specials:[],warnings:[{type:"danger",text:"計算錯誤："+e.message}],relations:[],crossAttacks:[]});
    }
    setPage("result");
  }

  function reset() {
    setPieces({center:null,left:null,right:null,top:null,bottom:null});
    setSelfColor(null); setResult(null); setPage("setup");
  }

  async function handleSave(note) {
    const ok=await saveRecord({id:Date.now(),date:new Date().toLocaleString("zh-TW"),qtype,question,pieces,selfColor,score:result?.score,note,teacherNote:""});
    if(ok){setSaveStatus("✓ 已儲存");loadRecords(isTeacher).then(setRecords);setTimeout(()=>setSaveStatus(""),2000);}
  }

  async function handleTeacherLogin() {
    await saveTeacherMode(true);
    setIsTeacher(true);
    setPage("history");
  }

  async function handleTeacherLogout() {
    await saveTeacherMode(false);
    setIsTeacher(false);
  }

  function refreshRecords() { loadRecords(isTeacher).then(setRecords); }

  if (page==="home") return (
    <div style={{minHeight:"100vh",background:S.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{fontSize:68,marginBottom:12,filter:"drop-shadow(0 0 20px rgba(240,208,96,0.35))"}}>♟</div>
      <h1 style={{fontSize:28,letterSpacing:8,color:S.gold,margin:"0 0 8px"}}>象棋占卜</h1>
      <p style={{color:S.muted,marginBottom:48,letterSpacing:3,fontSize:13}}>以棋問事，以棋觀勢</p>
      <div style={{width:"100%",maxWidth:300,display:"flex",flexDirection:"column",gap:10}}>
        <Btn onClick={()=>setPage("setup")}>✦ 開始占卜</Btn>
        <Btn onClick={()=>{setPage("history");loadRecords(isTeacher).then(setRecords);}} variant="secondary">歷史紀錄</Btn>
        <Btn onClick={()=>isTeacher?handleTeacherLogout():setPage("teacher-login")} variant="secondary"
          style={{fontSize:13,color:isTeacher?"#ff8888":"#777"}}>
          {isTeacher?"🔓 退出老師模式":"👨‍🏫 老師模式"}
        </Btn>
        <Btn onClick={()=>setPage("ai-settings")} variant="secondary" style={{fontSize:13,color:"#bbb"}}>⚙️ AI 設定</Btn>
      </div>
    </div>
  );

  if (page==="teacher-login") return <TeacherLoginPage onLogin={handleTeacherLogin} onBack={()=>setPage("home")}/>;
  if (page==="ai-settings") return <AISettingsPage onBack={()=>setPage("home")}/>;


  if (page==="setup") return (
    <div style={{minHeight:"100vh",background:S.bg,fontFamily:S.font,color:"#fff",padding:24}}>
      <div style={{maxWidth:440,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:28}}>
          <Btn onClick={()=>setPage("home")} variant="ghost" style={{width:"auto"}}>← 返回</Btn>
          <h2 style={{fontSize:20,color:S.gold,letterSpacing:4,margin:0}}>設定問題</h2>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{color:S.muted,marginBottom:10,fontSize:13,letterSpacing:2}}>問事方向</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {QTYPES.map(qt=>(
              <button key={qt.key} onClick={()=>setQtype(qt.key)} style={{
                padding:"12px 8px",borderRadius:8,cursor:"pointer",fontFamily:S.font,
                border:qtype===qt.key?`1px solid ${S.gold}`:S.border,
                background:qtype===qt.key?"rgba(240,208,96,0.12)":S.bg2,
                color:qtype===qt.key?S.gold:"#777",fontSize:14,letterSpacing:1,
              }}>{qt.icon} {qt.label}</button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{color:S.muted,marginBottom:10,fontSize:13,letterSpacing:2}}>你的問題</div>
          <textarea value={question} onChange={e=>setQuestion(e.target.value)}
            placeholder="例：這段感情值得繼續嗎？"
            style={{width:"100%",minHeight:80,padding:"12px 16px",background:S.bg2,border:S.border,borderRadius:8,color:"#fff",fontSize:14,resize:"vertical",fontFamily:S.font,boxSizing:"border-box"}}
          />
        </div>
        <div style={{marginBottom:28}}>
          <div style={{color:S.muted,marginBottom:10,fontSize:13,letterSpacing:2}}>抽棋方式</div>
          <div style={{display:"flex",gap:8}}>
            {[["draw","🎲 隨機翻牌"],["manual","✏️ 手動填入"]].map(([m,l])=>(
              <button key={m} onClick={()=>setInputMode(m)} style={{
                flex:1,padding:"12px",borderRadius:8,cursor:"pointer",fontFamily:S.font,
                border:inputMode===m?`1px solid ${S.gold}`:S.border,
                background:inputMode===m?"rgba(240,208,96,0.12)":S.bg2,
                color:inputMode===m?S.gold:"#777",fontSize:13,letterSpacing:1,
              }}>{l}</button>
            ))}
          </div>
          <div style={{color:"#999",fontSize:11,marginTop:8,lineHeight:1.6}}>
            {inputMode==="draw"?"隨機翻牌：點擊按鈕從棋子池隨機抽出，模擬真實起卦":"手動填入：自行選擇棋子，適合紀錄實體起卦結果"}
          </div>
        </div>
        <Btn onClick={()=>{if(!question.trim()){alert("請先填寫問題");return;}setPage(inputMode==="draw"?"draw":"manual");}}>
          開始起卦 →
        </Btn>
      </div>
    </div>
  );

  if (page==="draw") return <DrawPage question={question} qtype={qtype} onBack={()=>setPage("setup")} onDone={handleDone}/>;
  if (page==="manual") return <ManualPage question={question} qtype={qtype} onBack={()=>setPage("setup")} onDone={handleDone}/>;
  if (page==="result") return <ResultPage question={question} qtype={qtype} pieces={pieces} selfColor={selfColor} result={result||{score:0,details:[],specials:[],warnings:[],relations:[],crossAttacks:[]}} onReset={reset} onSave={handleSave} saveStatus={saveStatus}/>;
  if (page==="history") return <HistoryPage records={records} onBack={()=>setPage("home")} isTeacher={isTeacher} onRecordsUpdate={refreshRecords}/>;
  return null;
}
