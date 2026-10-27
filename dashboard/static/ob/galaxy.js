/* Adapted from the user's galaxy-template.html: spiral particles, dust, bloom, and constellations.
 * Three.js 0.160.0 is bundled locally in galaxy-engine.js; see THREE-LICENSE.txt.
 */
import {THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass} from './galaxy-engine.js';
const host=window.galaxyHost;
const PAL={
  '恋爱':'#ff7ec4','关系核心':'#ff8fd0','婚恋':'#ff9ad0','我们的故事':'#e888d8',
  '编程':'#8f9fff','AI':'#a98cff','网络':'#8fa8ff','心理':'#9a8cf0','自省':'#a89ce8','情绪':'#b48ce8',
  '家庭':'#ffcf8a','宠物':'#ffbe7a','居家':'#ffd6a3','回忆':'#f0c88a','工作':'#ffe39a','求职':'#ffdb88',
  '学习':'#ecd8a0','创作':'#dca0ec','写作':'#cca8f0','游戏':'#f09ce8','社交':'#9cc4ff','人际':'#aac0f0',
  '日常':'#cfd8f0','出行':'#a0c8dc','健康':'#c8e0bc','饮食':'#ffcf9a',
};
const FALL=['#ff9ed4','#b98cff','#8f9fff','#ffc98a','#c8a0f0','#e89ce8','#ffb0d8'];
function domCol(d){ if(PAL[d])return PAL[d]; let h=0;for(const c of (d||''))h=(h*31+c.charCodeAt(0))>>>0; return FALL[h%FALL.length]; }

const canvas=document.getElementById('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth < 650 ? 1.5 : 2));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;

const scene=new THREE.Scene();
scene.background=new THREE.Color('#050209');
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.1,100);
camera.position.set(0,3.1,6.3);

const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;controls.dampingFactor=.05;
controls.enablePan=false;controls.autoRotate=true;controls.autoRotateSpeed=.32;
controls.minDistance=2.2;controls.maxDistance=14;controls.target.set(0,0,0);
controls.maxPolarAngle=Math.PI*0.86;

const P_VERT=`
attribute float aSize; attribute float aPhase; attribute vec3 aColor;
uniform float uTime; uniform float uPix; varying vec3 vColor; varying float vTw;
void main(){
  vColor=aColor;
  float br=0.9+0.1*sin(uTime*0.28+aPhase);
  vTw=br;
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_PointSize=aSize*uPix*br*(1.0/-mv.z);
  gl_Position=projectionMatrix*mv;
}`;
const P_FRAG=`
varying vec3 vColor; varying float vTw;
void main(){
  float d=length(gl_PointCoord-0.5);
  float a=smoothstep(0.5,0.0,d);
  a=pow(a,1.6)*vTw;
  if(a<0.01) discard;
  gl_FragColor=vec4(vColor,a);
}`;
function particleMat(sizeScale){
  return new THREE.ShaderMaterial({
    uniforms:{uTime:{value:0},uPix:{value:renderer.getPixelRatio()*sizeScale}},
    vertexShader:P_VERT,fragmentShader:P_FRAG,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
}

function C(hex){const c=new THREE.Color(hex);return[c.r,c.g,c.b];}
const rand=(a,b)=>a+Math.random()*(b-a);
const pw=(p)=>Math.pow(Math.random(),p);

const GAL_R=5, BRANCHES=2, SPIN=1.15;
function buildGalaxy(){
  const N=innerWidth < 650 ? 8000 : 14000, pos=new Float32Array(N*3), col=new Float32Array(N*3), sz=new Float32Array(N), ph=new Float32Array(N);
  const cIn=C('#ffdcf2'), cMid=C('#c891ff'), cOut=C('#8fb0ff'), gold=C('#ffcf9a');
  for(let i=0;i<N;i++){
    const r=pw(1.7)*GAL_R;
    const branch=(i%BRANCHES)/BRANCHES*Math.PI*2;
    const spin=r*SPIN;
    const scat=0.55;
    const sx=pw(2.6)*(Math.random()<.5?1:-1)*scat*(r+0.4);
    const sz2=pw(2.6)*(Math.random()<.5?1:-1)*scat*(r+0.4);
    const sy=pw(3.0)*(Math.random()<.5?1:-1)*scat*0.34*(r+0.3);
    pos[i*3]=Math.cos(branch+spin)*r+sx;
    pos[i*3+1]=sy;
    pos[i*3+2]=Math.sin(branch+spin)*r+sz2;
    const tN=r/GAL_R;
    let cr,cg,cb;
    if(tN<0.5){const k=tN/0.5;cr=cIn[0]+(cMid[0]-cIn[0])*k;cg=cIn[1]+(cMid[1]-cIn[1])*k;cb=cIn[2]+(cMid[2]-cIn[2])*k;}
    else{const k=(tN-0.5)/0.5;cr=cMid[0]+(cOut[0]-cMid[0])*k;cg=cMid[1]+(cOut[1]-cMid[1])*k;cb=cMid[2]+(cOut[2]-cMid[2])*k;}
    if(Math.random()<0.06){cr=gold[0];cg=gold[1];cb=gold[2];}
    col[i*3]=cr;col[i*3+1]=cg;col[i*3+2]=cb;
    sz[i]=rand(1.4,5.0)*(tN<0.3?1.15:1);
    ph[i]=Math.random()*6.28;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('aColor',new THREE.BufferAttribute(col,3));
  g.setAttribute('aSize',new THREE.BufferAttribute(sz,1));
  g.setAttribute('aPhase',new THREE.BufferAttribute(ph,1));
  return new THREE.Points(g,particleMat(1.05));
}

function buildDust(){
  const N=innerWidth < 650 ? 2600 : 6400, pos=new Float32Array(N*3), col=new Float32Array(N*3), sz=new Float32Array(N), ph=new Float32Array(N);
  const cols=[C('#e8b8ff'),C('#9fb8ff'),C('#ffd0ec'),C('#c8a0f0'),C('#ffe0b0')];
  for(let i=0;i<N;i++){
    const r=pw(1.1)*GAL_R*1.7+0.5;
    const th=Math.random()*Math.PI*2, y=(Math.random()-0.5)*GAL_R*1.1;
    pos[i*3]=Math.cos(th)*r; pos[i*3+1]=y; pos[i*3+2]=Math.sin(th)*r;
    const c=cols[Math.floor(Math.random()*cols.length)];
    col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];
    sz[i]=rand(0.5,1.8); ph[i]=Math.random()*6.28;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('aColor',new THREE.BufferAttribute(col,3));
  g.setAttribute('aSize',new THREE.BufferAttribute(sz,1));
  g.setAttribute('aPhase',new THREE.BufferAttribute(ph,1));
  const m=particleMat(1);m.uniforms.uPix.value*=0.9;
  return new THREE.Points(g,m);
}

let mem=[], core=null, memPoints=null, origColor=null, origSize=null;
function buildMemories(stars) {
  clearHighlight();
  if (memPoints) { scene.remove(memPoints); memPoints.geometry.dispose(); memPoints.material.dispose(); }
  const epoch = star => Number.isFinite(Date.parse(star.created)) ? Date.parse(star.created) : Infinity;
  const sorted = stars.slice().sort((a,b) => epoch(a)-epoch(b) || String(a.id).localeCompare(String(b.id)));
  const valid = sorted.map(epoch).filter(Number.isFinite);
  const t0 = valid[0] || 0, t1 = valid[valid.length-1] || t0;
  mem = sorted.map((s,i) => {
    let seed=0;
    for (const char of String(s.id)) seed=(seed*31+char.charCodeAt(0))>>>0;
    const fraction = sorted.length > 1 ? i/(sorted.length-1) : 0;
    const time = Number.isFinite(epoch(s)) && t1>t0 ? (epoch(s)-t0)/(t1-t0) : fraction;
    const r=.15+Math.pow(time*.85+fraction*.15,.85)*GAL_R*.96;
    const angle=(i%BRANCHES)/BRANCHES*Math.PI*2+r*SPIN;
    const x=Math.cos(angle)*r+((seed%100)/100-.5)*.48;
    const z=Math.sin(angle)*r+(((seed>>>8)%100)/100-.5)*.48;
    const y=(((seed>>>16)%100)/100-.5)*.28;
    const domains=Array.isArray(s.domain)?s.domain:[];
    const tags=Array.isArray(s.tags)?s.tags:[];
    return {s,x,y,z,imp:s.importance||4,color:domCol(domains[0]||tags[0]||'')};
  });
  core=mem[0]||null;
  if(core){core.x=0;core.y=0;core.z=0;core.isCore=true;}
  const N=mem.length, pos=new Float32Array(N*3),col=new Float32Array(N*3),sz=new Float32Array(N),ph=new Float32Array(N);
  mem.forEach((m,i)=>{
    pos.set([m.x,m.y,m.z],i*3);
    const tier=m.isCore?3:((m.s.pinned||m.imp>=9)?2:(m.imp>=7?1:0));
    m.tier=tier;
    sz[i]=[9,14,20,23][tier];
    const dim=[.8,1,1.2,1.35][tier],color=C(m.color);
    col.set(color.map(value=>value*dim),i*3);
    ph[i]=i*2.39;
  });
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geometry.setAttribute('aColor',new THREE.BufferAttribute(col,3));
  geometry.setAttribute('aSize',new THREE.BufferAttribute(sz,1));
  geometry.setAttribute('aPhase',new THREE.BufferAttribute(ph,1));
  memPoints=new THREE.Points(geometry,particleMat(1.4));
  scene.add(memPoints);
  origColor=Float32Array.from(col); origSize=Float32Array.from(sz);
}

let coreGlow=null;
function buildCoreGlow(){
  const s=128,cv=document.createElement('canvas');cv.width=cv.height=s;
  const g=cv.getContext('2d'),grd=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  grd.addColorStop(0,'rgba(255,226,246,.5)');grd.addColorStop(.28,'rgba(234,178,242,.2)');
  grd.addColorStop(.62,'rgba(186,142,236,.06)');grd.addColorStop(1,'rgba(162,126,226,0)');
  g.fillStyle=grd;g.fillRect(0,0,s,s);
  const mat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.4});
  coreGlow=new THREE.Sprite(mat);coreGlow.scale.set(1.8,1.8,1);scene.add(coreGlow);
}

function buildOrbits(){
  for(const r of [1.3,2.4,3.6,4.7]){
    const g=new THREE.RingGeometry(r-0.006,r+0.006,128);
    const m=new THREE.MeshBasicMaterial({color:'#ffd9a0',transparent:true,opacity:0.05,
      side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
    const ring=new THREE.Mesh(g,m);ring.rotation.x=-Math.PI/2;scene.add(ring);
  }
}

const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.6,0.62,0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let galaxy=null,dustPts=null;
const meteors=[]; let meteorTimer=2.5;
function spawnMeteor(){
  const R=GAL_R*1.5, TRAIL=14;
  const start=new THREE.Vector3((Math.random()-0.5)*R*2, rand(1.5,4.5), (Math.random()-0.5)*R*2);
  const vel=new THREE.Vector3(rand(-1,1),-rand(.3,.7),rand(-1,1)).normalize().multiplyScalar(rand(5,8));
  const geo=new THREE.BufferGeometry(),pos=new Float32Array(TRAIL*3),col=new Float32Array(TRAIL*3);
  const tint=[[1,.92,1],[1,.85,.95],[.9,.92,1]][Math.floor(Math.random()*3)];
  for(let i=0;i<TRAIL;i++){const a=Math.pow(1-i/TRAIL,1.5);col[i*3]=tint[0]*a;col[i*3+1]=tint[1]*a;col[i*3+2]=tint[2]*a;}
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  const line=new THREE.Line(geo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  scene.add(line);
  meteors.push({line,vel,life:0,ttl:rand(1.1,1.8),trail:Array.from({length:TRAIL},()=>start.clone())});
}
function updateMeteors(dt){
  for(let i=meteors.length-1;i>=0;i--){
    const m=meteors[i]; m.life+=dt;
    const head=m.trail[0].clone().addScaledVector(m.vel,dt);
    m.trail.unshift(head); m.trail.pop();
    const arr=m.line.geometry.attributes.position.array;
    m.trail.forEach((p,j)=>{arr[j*3]=p.x;arr[j*3+1]=p.y;arr[j*3+2]=p.z;});
    m.line.geometry.attributes.position.needsUpdate=true;
    m.line.material.opacity=Math.min(1,m.life*3)*Math.max(0,1-m.life/m.ttl);
    if(m.life>=m.ttl){scene.remove(m.line);m.line.geometry.dispose();m.line.material.dispose();meteors.splice(i,1);}
  }
}

const NOISE_DOM=new Set(['','其他','未分类','feel','plan']);
let hlLines=null, hlActive=[];
function clearHighlight(){
  if(hlLines){scene.remove(hlLines);hlLines.geometry.dispose();hlLines.material.dispose();hlLines=null;}
  if(hlActive.length&&memPoints){
    const cA=memPoints.geometry.attributes.aColor, sA=memPoints.geometry.attributes.aSize;
    hlActive.forEach(i=>{cA.array[i*3]=origColor[i*3];cA.array[i*3+1]=origColor[i*3+1];cA.array[i*3+2]=origColor[i*3+2];sA.array[i]=origSize[i];});
    cA.needsUpdate=true;sA.needsUpdate=true;
  }
  hlActive=[];
}
function highlight(index){
  clearHighlight();
  const A=mem[index];
  const rel=mem.map((m,i)=>({m,i})).filter(o=>o.i!==index && [...(o.m.s.domain||[]),...(o.m.s.tags||[])].some(tag=>[...(A.s.domain||[]),...(A.s.tags||[])].includes(tag) && !NOISE_DOM.has(tag)))
    .sort((a,b)=>b.m.imp-a.m.imp).slice(0,8);
  const idxs=[index,...rel.map(o=>o.i)];
  const cA=memPoints.geometry.attributes.aColor, sA=memPoints.geometry.attributes.aSize;
  idxs.forEach((i,k)=>{
    cA.array[i*3]=Math.min(2.2,origColor[i*3]*2.6);
    cA.array[i*3+1]=Math.min(2.2,origColor[i*3+1]*2.6);
    cA.array[i*3+2]=Math.min(2.2,origColor[i*3+2]*2.6);
    sA.array[i]=origSize[i]*(k===0?2.4:1.9)+4;
  });
  cA.needsUpdate=true;sA.needsUpdate=true; hlActive=idxs;
  const lp=[]; rel.forEach(o=>lp.push(A.x,A.y,A.z,o.m.x,o.m.y,o.m.z));
  if(lp.length){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));
    hlLines=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:new THREE.Color(A.color),
      transparent:true,opacity:.4,blending:THREE.AdditiveBlending,depthWrite:false}));
    scene.add(hlLines);
  }
}

// Stop the render loop when the tab, frame, or browser is hidden.
let frameId=0, elapsed=0, lastTime=0, lastPaint=0, contextLost=false;
function animate(now) {
  frameId=0;
  if (!host.active || document.hidden || contextLost) return;
  frameId=requestAnimationFrame(animate);
  if(now-lastPaint<1000/30) return;
  const dt=lastTime?Math.min((now-lastTime)/1000,.05):0;
  lastTime=now; lastPaint=now;
  controls.autoRotate=!host.paused;
  if(!host.paused) {
    elapsed+=dt;
    meteorTimer-=dt;
    if(meteorTimer<=0){spawnMeteor();meteorTimer=rand(4,9);}
    updateMeteors(dt);
  }
  for(const points of [galaxy,dustPts,memPoints]) if(points) points.material.uniforms.uTime.value=elapsed;
  if(coreGlow) {
    coreGlow.scale.setScalar(1.8*(1+.06*Math.sin(elapsed*.85)));
    coreGlow.material.opacity=.32+.04*Math.sin(elapsed*.85);
  }
  controls.update();
  composer.render();
}
function resume() {
  if(!host.active || document.hidden || contextLost) {
    if(frameId) cancelAnimationFrame(frameId);
    frameId=0; lastTime=0;
  } else if(!frameId) {
    lastTime=0;
    frameId=requestAnimationFrame(animate);
  }
}
document.addEventListener('galaxy-activity',resume);
document.addEventListener('visibilitychange',resume);
document.addEventListener('galaxy-data',()=>buildMemories(host.stars||[]));
document.addEventListener('galaxy-select',event=>{
  const index=mem.findIndex(m=>m.s.id===event.detail);
  if(index>=0) highlight(index);
});
document.addEventListener('galaxy-clear',clearHighlight);

// Screen-space picking gives small stars a comfortable touch target at any zoom.
let down=null;
const pointers=new Set();
canvas.addEventListener('pointerdown',event=>{
  pointers.add(event.pointerId);
  down=pointers.size===1?[event.clientX,event.clientY]:null;
});
canvas.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);down=null;});
canvas.addEventListener('pointerup',event=>{
  pointers.delete(event.pointerId);
  if(!down) return;
  const moved=Math.hypot(event.clientX-down[0],event.clientY-down[1]);
  down=null;
  if(moved>8 || pointers.size) return;
  let best=-1, nearest=18;
  const point=new THREE.Vector3();
  mem.forEach((memory,index)=>{
    point.set(memory.x,memory.y,memory.z).project(camera);
    if(point.z < -1 || point.z>1) return;
    const distance=Math.hypot((point.x*.5+.5)*innerWidth-event.clientX,(-point.y*.5+.5)*innerHeight-event.clientY);
    if(distance<nearest){nearest=distance;best=index;}
  });
  if(best>=0) host.read(mem[best].s.id);
});
document.getElementById('galaxy-reset').addEventListener('click',()=>{
  camera.position.set(0,3.1,6.3);
  controls.target.set(0,0,0);
  controls.update();
});
addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
  composer.setSize(innerWidth,innerHeight);
});
canvas.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  contextLost=true;
  host.active=false; resume();
  host.fail('星河显示暂时中断，仍可用菜单阅读记忆；刷新页面可重试。');
});
addEventListener('pagehide',()=>{
  host.active=false; resume(); controls.dispose(); composer.dispose();
  scene.traverse(object=>{
    if(object.geometry) object.geometry.dispose();
    const materials=Array.isArray(object.material)?object.material:[object.material];
    materials.forEach(material=>{if(material){if(material.map)material.map.dispose();material.dispose();}});
  });
  renderer.dispose();
},{once:true});

galaxy=buildGalaxy(); scene.add(galaxy);
dustPts=buildDust(); scene.add(dustPts);
buildOrbits(); buildCoreGlow();
if(host.stars) buildMemories(host.stars);
resume();
