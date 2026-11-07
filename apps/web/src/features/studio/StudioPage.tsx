import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { CREATION_TYPE_LABELS, type CreationType } from "@workbench/shared";

export function StudioPage() {
  const { type } = useParams();
  const creation = (type && type in CREATION_TYPE_LABELS ? type : "ai_video") as CreationType;
  return (
    <>
      <PageHeader title={CREATION_TYPE_LABELS[creation]} description="组织需求、素材、制作演示和成果。" />
      <EmptyState title="创作草稿区域" description="选择素材与技能后即可开始组织本次创作。" />
    </>
  );
}
