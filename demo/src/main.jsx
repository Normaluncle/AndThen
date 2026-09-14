import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,setToken} from './api.js';
import './style.css';
import DesignApp from './design/DesignApp.jsx';

function App(){
 const [user,setUser]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;(async()=>{
  try{const data=await api('/me');if(active){setToken(true);setUser(data.user);}}
  catch(e){if(active){setToken(false);if(e.status!==401)setError('暂时无法恢复登录，请重新连接。');}}
  if(active&&new URLSearchParams(location.search).has('oauth')){history.replaceState(null,'','/?screen=09&tab=settings');window.dispatchEvent(new PopStateEvent('popstate'));}
 })();return()=>{active=false;};},[]);
 return <DesignApp user={user} onUser={setUser} connectionError={error}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
