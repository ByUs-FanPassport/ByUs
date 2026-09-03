import{z}from"zod";
export const actionRequiredNotificationKindSchema=z.enum(["benefit_won","recipient_information_required","fulfillment_meaningful_update","collectible_claim_available","collectible_claim_expiring"]);
export type ActionRequiredNotificationKind=z.infer<typeof actionRequiredNotificationKindSchema>;
export function actionRequiredSourceKey(kind:ActionRequiredNotificationKind,entityId:string,revisionOrWindow:string|number){return`${kind}:${entityId}:${revisionOrWindow}`;}
