import { CelebrityDirectory } from "../../components/celebrity-directory";
import { publishedCelebrityFixtures } from "../../components/public-celebrity-fixtures";

export default function CelebritiesPage() {
  return <CelebrityDirectory celebrities={publishedCelebrityFixtures} />;
}
