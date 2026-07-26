import {
  challengeQnaAnswerAttemptSchema,
  challengeQnaSessionSchema,
  type ChallengeQnaAnswerAttempt,
  type ChallengeQnaSession,
} from "@orbit/shared/coaching";
import { normalizeCoachingAudioMimeType } from "./coachingAudioMimeType";

export type ChallengeQuestionView = {
  questionId:string;revision:number;order:number;questionType:string;difficulty:string;questionText:string;
  assistanceLevel:"none"|"concept-hint"|"slide-hint"|"full-guide";answerGuide:any|null;
  conceptHints:string[];slideHints:Array<{slideId:string;title:string}>;sourceRefs:any[];
};
export type ChallengeQnaView = { session:ChallengeQnaSession;questions:ChallengeQuestionView[];attempts:ChallengeQnaAnswerAttempt[] };

async function parse(response:Response){const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error((body as any).message??"요청을 처리하지 못했습니다.");return body as any;}

export async function createChallengeQna(projectId:string,sourceFullRunId:string,clientRequestId:string){
  const body=await parse(await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/challenge-qna-sessions`,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({clientRequestId,source:{mode:"final",sourceFullRunId,questionCount:3}})}));
  return normalize(body);
}
export async function getChallengeQna(sessionId:string){return normalize(await parse(await fetch(`/api/v1/challenge-qna-sessions/${encodeURIComponent(sessionId)}`,{credentials:"include"})));}
export async function revealChallengeAssistance(sessionId:string,questionId:string,revision:number,level:"concept-hint"|"slide-hint"|"full-guide"){
  return normalize(await parse(await fetch(`/api/v1/challenge-qna-sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/assistance`,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({questionRevision:revision,level})})));
}
export async function submitTextAnswer(sessionId:string,question:ChallengeQuestionView,answerText:string){
  const body=await parse(await fetch(`/api/v1/challenge-qna-sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(question.questionId)}/answers`,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({clientRequestId:crypto.randomUUID(),questionRevision:question.revision,inputMode:"text",answerText})}));
  return challengeQnaAnswerAttemptSchema.parse(body.attempt);
}
export async function submitVoiceAnswer(sessionId:string,question:ChallengeQuestionView,capture:{blob:Blob;durationMs:number}){
  const created=await parse(await fetch(`/api/v1/challenge-qna-sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(question.questionId)}/answers`,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({clientRequestId:crypto.randomUUID(),questionRevision:question.revision,inputMode:"voice",mimeType:normalizeCoachingAudioMimeType(capture.blob.type),size:capture.blob.size})}));
  await fetch(created.upload.uploadUrl,{method:created.upload.method,headers:created.upload.headers,body:capture.blob}).then((response)=>{if(!response.ok)throw new Error("음성 업로드에 실패했습니다.");});
  const completed=await parse(await fetch(`/api/v1/challenge-qna-answer-attempts/${encodeURIComponent(created.attempt.answerAttemptId)}/audio/complete`,{method:"POST",headers:{"content-type":"application/json"},credentials:"include",body:JSON.stringify({fileId:created.upload.fileId,durationMs:capture.durationMs})}));
  return challengeQnaAnswerAttemptSchema.parse(completed.attempt);
}
export async function advanceChallengeQna(sessionId:string){const body=await parse(await fetch(`/api/v1/challenge-qna-sessions/${encodeURIComponent(sessionId)}/advance`,{method:"POST",credentials:"include"}));return challengeQnaSessionSchema.parse(body.session);}

function normalize(body:any):ChallengeQnaView{return {session:challengeQnaSessionSchema.parse(body.session),questions:Array.isArray(body.questions)?body.questions:[],attempts:(body.attempts??[]).map((item:unknown)=>challengeQnaAnswerAttemptSchema.parse(item))};}
