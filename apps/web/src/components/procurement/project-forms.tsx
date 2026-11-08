"use client";

import { useLocale, useTranslations } from "next-intl";
import { createManualBoqAction, saveProjectAction, setProjectMemberAction, uploadBoqAction } from "@/app/actions/procurement";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";

const TYPES = ["residential", "commercial", "industrial", "infrastructure", "healthcare", "education", "hospitality", "government", "other"] as const;
const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

type Opt = { value: string; label: string };
type Project = {
  id: string;
  name: string;
  description: string | null;
  projectType: string;
  status: string;
  visibility: string;
  city: string | null;
  siteAddress: string | null;
  managerUserId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  budget: string | null;
};

const d = (v: Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

export function ProjectDialog({ project, members, cities }: { project?: Project; members: Opt[]; cities: Opt[] }) {
  const t = useTranslations();
  return (
    <Modal wide title={project ? t("common.edit") : t("projects.new")} trigger={project ? <Button variant="outline">{t("common.edit")}</Button> : <Button>{t("projects.new")}</Button>}>
      <ActionForm action={saveProjectAction} successMessage={project ? t("projects.updated") : t("projects.created")} redirectTo={project ? undefined : (r: { id: string }) => `/org/projects/${r.id}`}>
        <FormError />
        {project ? <input type="hidden" name="id" value={project.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" required label={t("projects.name")} defaultValue={project?.name} className="sm:col-span-2" />
          <Field as="select" name="projectType" label={t("projects.type")} defaultValue={project?.projectType ?? "other"} options={TYPES.map((x) => ({ value: x, label: t(`projects.types.${x}`) }))} />
          <Field as="select" name="status" label={t("projects.status")} defaultValue={project?.status ?? "planning"} options={STATUSES.map((x) => ({ value: x, label: t(`projects.statuses.${x}`) }))} />
          <Field as="select" name="managerUserId" label={t("projects.manager")} defaultValue={project?.managerUserId ?? ""} placeholder="—" options={members} />
          <Field as="select" name="city" label={t("projects.city")} defaultValue={project?.city ?? ""} placeholder="—" options={cities} />
          <Field name="siteAddress" label={t("projects.siteAddress")} defaultValue={project?.siteAddress ?? ""} className="sm:col-span-2" />
          <Field name="startDate" type="date" label={t("projects.startDate")} defaultValue={d(project?.startDate ?? null)} dir="ltr" />
          <Field name="endDate" type="date" label={t("projects.endDate")} defaultValue={d(project?.endDate ?? null)} dir="ltr" />
          <Field name="budget" inputMode="decimal" label={t("projects.budget")} defaultValue={project?.budget ?? ""} dir="ltr" />
          <Field as="select" name="visibility" label={t("projects.visibility")} defaultValue={project?.visibility ?? "org"} options={(["org", "members"] as const).map((x) => ({ value: x, label: t(`projects.visibilityOptions.${x}`) }))} />
          <Field as="textarea" name="description" label={t("projects.description")} defaultValue={project?.description ?? ""} className="sm:col-span-2" />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ProjectMemberDialog({ projectId, users }: { projectId: string; users: Opt[] }) {
  const t = useTranslations();
  return (
    <Modal title={t("projects.addMember")} trigger={<Button size="sm" variant="outline">{t("projects.addMember")}</Button>}>
      <ActionForm action={setProjectMemberAction} successMessage={t("common.saved")}>
        <FormError />
        <input type="hidden" name="projectId" value={projectId} />
        <Field as="select" name="userId" required label={t("members.member")} placeholder={t("common.select")} options={users} />
        <Field as="select" name="role" label={t("projects.role")} defaultValue="member" options={(["manager", "member", "viewer"] as const).map((r) => ({ value: r, label: t(`projects.roles.${r}`) }))} />
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function BoqUploadDialog({ projects, projectId }: { projects: Opt[]; projectId?: string }) {
  const t = useTranslations();
  return (
    <Modal title={t("boq.upload")} description={t("boq.uploadHint")} trigger={<Button>{t("boq.upload")}</Button>}>
      <ActionForm action={uploadBoqAction} successMessage={t("boq.uploaded")} redirectTo={(r: { id: string }) => `/org/boq/${r.id}`}>
        <FormError />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : <Field as="select" name="projectId" label={t("boq.project")} placeholder={t("projects.none")} options={projects} />}
        <Field name="title" label={t("boq.titleField")} />
        <Field name="file" type="file" required accept=".xlsx,.csv,.pdf,.png,.jpg,.jpeg,.webp" label={t("boq.file")} />
        <div className="flex justify-end">
          <SubmitButton>{t("common.upload")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ManualBoqDialog({ projects, projectId }: { projects: Opt[]; projectId?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  void locale;
  return (
    <Modal title={t("boq.manual")} trigger={<Button variant="outline">{t("boq.manual")}</Button>}>
      <ActionForm action={createManualBoqAction} redirectTo={(r: { id: string }) => `/org/boq/${r.id}`}>
        <FormError />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : <Field as="select" name="projectId" label={t("boq.project")} placeholder={t("projects.none")} options={projects} />}
        <Field name="title" required label={t("boq.titleField")} />
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}
