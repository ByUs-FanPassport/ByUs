import { QuizManager } from "../../../../../components/admin/quiz-manager";
export default async function Page({params}:{params:Promise<{id:string}>}){return <QuizManager celebrityId={(await params).id}/>}

