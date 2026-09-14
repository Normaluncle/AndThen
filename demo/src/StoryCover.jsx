import React,{useState,useEffect} from 'react';
import {coverPool} from './cover-pool.js';
import {selectCover,coverCaption} from './design/search-model.js';
import {HomeIcon} from './Home.jsx';
export function StoryCover({item,className=''}){const cover=item.cover_url?{src:item.cover_url,alt:'故事配图'}:selectCover(item,coverPool);const caption=coverCaption(item);const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[cover?.src]);return <span className={`story-cover ${className}`} role="img" aria-label={failed?'故事封面暂不可用':cover?.alt||'故事封面待补充'}>{cover&&!failed?<img src={cover.src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<HomeIcon name="book"/>}{caption.length>0&&<span className="story-cover-caption"><span className="story-cover-date">{caption[0]}</span>{caption[0]&&<br/>}{caption[1]}</span>}</span>;}
