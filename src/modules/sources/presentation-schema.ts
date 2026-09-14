import {z} from 'zod';
export const COVER_CATEGORIES=['职场发展','人生选择','学习成长','情感关系','创业思考','家庭生活','健康恢复','自我反思','迁移生活','通用留白'] as const;
export const coverAnalysisSchema=z.object({category:z.enum(COVER_CATEGORIES),tags:z.array(z.string().trim().min(1).max(20)).max(6),caption:z.string().trim().min(2).max(20),evidence_refs:z.array(z.string()).min(1).max(3)}).strict();
export const presentationShape={category:z.string(),tags:z.array(z.string()),cover_id:z.string().nullable(),cover_url:z.string().nullable(),cover_caption:z.string().nullable(),cover_status:z.enum(['ready','pending_asset'])};
export type Presentation= z.infer<z.ZodObject<typeof presentationShape>>;
