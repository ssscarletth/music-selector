/* Public client ID only. OAuth credentials stay in this browser tab. */
(() => {
  const clientId = 'a4c4b3722e3a413bb977dc90eed2d50d';
  const redirectUri = location.hostname === '127.0.0.1'
    ? location.origin + '/callback'
    : new URL('index.html', location.href).href.split('?')[0].split('#')[0];
  const key = 'music-spotify-token';
  const read = name => { try { return JSON.parse(sessionStorage.getItem(name)); } catch { return null; } };
  let credentials = read(key), refresh;
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function exchange(parameters) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: clientId, ...parameters})
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        credentials = null; sessionStorage.removeItem(key);
      }
      throw Error('Spotify authorization expired or failed. Click the record to reconnect.');
    }
    const data = await response.json();
    credentials = {...data, refresh_token: data.refresh_token || credentials?.refresh_token,
      expires: Date.now() + data.expires_in * 1000};
    sessionStorage.setItem(key, JSON.stringify(credentials));
    return credentials.access_token;
  }
  async function token() {
    if (!credentials) throw Error('Connect Spotify first.');
    if (credentials.expires > Date.now() + 60000) return credentials.access_token;
    if (!refresh) refresh = exchange({grant_type:'refresh_token', refresh_token:credentials.refresh_token}).finally(() => refresh = null);
    return refresh;
  }
  async function authorize() {
    const verifier = encode(crypto.getRandomValues(new Uint8Array(64)));
    const state = encode(crypto.getRandomValues(new Uint8Array(24)));
    sessionStorage.setItem('music-spotify-auth', JSON.stringify({verifier, state, redirectUri, time:Date.now()}));
    window.saveMusicSession?.();
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    location.assign('https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id:clientId, response_type:'code', redirect_uri:redirectUri, state,
      code_challenge_method:'S256', code_challenge:challenge,
      scope:'streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state'
    }));
  }
  let callbackError = null;
  const initialized = (async () => {
    const query = new URLSearchParams(location.search);
    if (!query.has('code') && !query.has('error')) return;
    const auth = read('music-spotify-auth');
    sessionStorage.removeItem('music-spotify-auth');
    history.replaceState({}, '', location.pathname === '/callback' ? '/' : location.pathname);
    try {
      if (!auth || query.get('state') !== auth.state || Date.now()-auth.time > 600000) throw Error('Spotify login could not be verified. Click the record to try again.');
      if (query.has('error')) throw Error('Spotify permission was not granted. Click the record to try again.');
      await exchange({grant_type:'authorization_code',code:query.get('code'),redirect_uri:auth.redirectUri,code_verifier:auth.verifier});
    } catch (error) { callbackError = error; }
  })();
  let sdk;
  function loadSDK() {
    return sdk ||= new Promise((resolve, reject) => {
      if (window.Spotify) return resolve();
      const timer = setTimeout(() => reject(Error('Spotify player took too long to load. Reload and try again.')),20000);
      window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timer); resolve(); };
      const script = document.createElement('script'); script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.onerror = () => { clearTimeout(timer); reject(Error('Could not load Spotify player. Check your connection.')); };
      document.head.appendChild(script);
    });
  }
  class SpotifyAudio extends EventTarget {
    constructor() {
      super(); this.src=''; this.currentTime=0; this.duration=0; this.ended=false;
      this.paused=true; this.version=0; this.commands=Promise.resolve(); this.last=null;
    }
    emit(name) { this.dispatchEvent(new Event(name)); }
    enqueue(task) { const result=this.commands.then(task); this.commands=result.catch(()=>{}); return result; }
    activate() { this.player?.activateElement().catch(()=>{}); }
    async connect() {
      if (this.device) return;
      if (this.connection) return this.connection;
      this.connection = (async () => {
        await loadSDK();
        this.player?.disconnect();
        this.player = new Spotify.Player({name:'Music Selector',volume:0.65,
          getOAuthToken:cb=>token().then(cb).catch(error=>this.fail(error))});
        this.player.addListener('player_state_changed', state=>this.accept(state));
        this.player.addListener('not_ready',()=>{this.device=null;this.paused=true;this.emit('pause');});
        this.player.addListener('autoplay_failed',()=>this.fail(Error('Click the record again to allow audio playback.')));
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('Spotify could not connect. Reload and try again.')),20000);
          this.player.addListener('ready',({device_id})=>{clearTimeout(timer);this.device=device_id;resolve();});
          for(const name of ['initialization_error','authentication_error','account_error','playback_error']) {
            this.player.addListener(name,({message})=>{clearTimeout(timer);const error=Error(message);reject(error);this.fail(error);});
          }
          this.player.connect().then(ok=>{if(!ok){clearTimeout(timer);reject(Error('Spotify connection failed.'));}}).catch(reject);
        });
        clearInterval(this.poll);
        this.poll=setInterval(()=>{
          const epoch=this.seekEpoch;
          this.player.getCurrentState().then(s=>{if(epoch===this.seekEpoch)this.accept(s);}).catch(()=>{});
        },500);
      })().finally(()=>this.connection=null);
      return this.connection;
    }
    fail(error) { this.error=error;this.paused=true;this.emit('error'); }
    accept(state) {
      if(this.seeking)return;
      if(this.seekTarget && this.seekTarget.src!==this.src)this.seekTarget=null;
      if (!state) {
        if(this.seekTarget && performance.now()<this.seekTarget.until)return;
        this.seekTarget=null;this.paused=true;this.emit('pause');return;
      }
      const track=state.track_window.current_track;
      const matches=track?.uri===this.src || track?.linked_from?.uri===this.src;
      const previous=this.last;
      // Seek completion can precede the SDK's position update. Keep the
      // requested position until a matching state arrives (bounded to 2s).
      if(this.seekTarget){
        const target=this.seekTarget;
        const elapsed=state.paused?0:Math.max(0,performance.now()-target.at);
        const confirmed=matches && state.position>=target.position-500 &&
          state.position<=target.position+elapsed+1500;
        if(!confirmed && performance.now()<target.until)return;
        this.seekTarget=null;
      }
      if (!matches) { this.paused=true;this.emit('pause');return; }
      this.currentTime=state.position/1000;this.duration=state.duration/1000;
      this.paused=state.paused;
      this.last={src:this.src,position:state.position,duration:state.duration,paused:state.paused};
      this.emit('timeupdate');
      if (!this.ended && previous?.src===this.src && !previous.paused &&
          previous.duration-previous.position<2000 && state.paused && state.position===0) {
        this.ended=true;this.emit('ended');return;
      }
      this.emit(state.paused?'pause':'playing');
    }
    async play() {
      this.activate();
      const version=++this.version, src=this.src;
      await initialized;
      if (!credentials) { await authorize(); return; }
      await this.connect();
      if(version!==this.version)return;
      return this.enqueue(async()=>{
        if(version!==this.version)return;
        if (this.last?.src===src && !this.ended) await this.player.resume();
        else {
          this.last=null;this.ended=false;
          const access=await token();
          const response=await fetch('https://api.spotify.com/v1/me/player/play?device_id='+encodeURIComponent(this.device),{
            method:'PUT',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
            body:JSON.stringify({uris:[src],position_ms:0})
          });
          if(!response.ok){
            if(response.status===401){credentials=null;sessionStorage.removeItem(key);}
            throw Error(response.status===403?'Spotify denied playback. Check Premium and app access in the Dashboard.':
              'Spotify playback failed ('+response.status+'). Click the record to retry.');
          }
        }
      });
    }
    async seek(seconds) {
      const src=this.src,version=this.version;
      return this.enqueue(async()=>{
        if(!this.device||src!==this.src||version!==this.version)return;
        this.seeking=true;this.seekEpoch=(this.seekEpoch||0)+1;this.seekTarget=null;
        try{
          await this.player.seek(Math.round(seconds*1000));
          this.currentTime=seconds;this.ended=false;
          const at=performance.now();
          this.seekTarget={src,position:seconds*1000,at,until:at+2000};
          this.last={src,position:seconds*1000,duration:this.duration*1000,paused:this.paused};
        }finally{this.seeking=false;this.emit('timeupdate');}
      });
    }
    pause() {
      ++this.version;this.paused=true;
      this.enqueue(()=>this.device?this.player.pause():undefined).catch(error=>this.fail(error));
    }
  }
  window.SpotifyAudio=SpotifyAudio;
  window.spotifyPlaybackReady=initialized.then(()=>{
    window.spotifyAuthError=callbackError?.message||'';
    return !!credentials;
  });
})();
