import React from 'react';
import {formatParagraphs} from './article-format.js';
export function Article({statement}){
 return <section className="article-answer">{statement.question&&<h3>问：{statement.question}</h3>}{formatParagraphs(statement.text).split(/\n+/).filter(Boolean).map((line,i)=>line.startsWith('## ')?<h4 key={i}>{line.slice(3)}</h4>:<p key={i} className="body">{line.startsWith('- ')?'• '+line.slice(2):line}</p>)}</section>;
}
