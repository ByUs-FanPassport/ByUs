"use client";

import { AlertCircle, ImagePlus, Plus, Search, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import styles from "./admin.module.css";
import { useAdminSession } from "./use-admin-session";

type CelebrityManagerAccess = "unauthenticated" | "integration-pending";
export type DeploymentEnvironment = "Development" | "Preview" | "Production";

export function AuthorizedCelebrityManager({ environment }: { environment: DeploymentEnvironment }) {
  const session = useAdminSession();
  if (session.status !== "authorized") {
    return <CelebrityManager access="unauthenticated" environment={environment} />;
  }
  return <CelebrityManager access="integration-pending" environment={environment} />;
}

export function CelebrityManager({ access, environment = "Development" }: { access: CelebrityManagerAccess; environment?: DeploymentEnvironment }) {
  if (access === "unauthenticated") {
    return (
      <main className={styles.accessPage}>
        <section className={styles.accessPanel} aria-labelledby="access-heading">
          <ShieldAlert aria-hidden="true" />
          <h1 id="access-heading">관리자 로그인이 필요합니다</h1>
          <p>셀럽 콘텐츠와 운영 정보는 권한이 확인된 관리자에게만 표시됩니다.</p>
          <Link className={styles.primaryLink} href={"/admin/login" as Route}>관리자 로그인</Link>
        </section>
      </main>
    );
  }

  const disabled = true;

  return (
    <div className={styles.adminPage}>
      <header className={styles.topbar}>
        <Link className={styles.adminBrand} href={"/admin" as Route}>ByUs <span>Admin</span></Link>
        <span className={styles.environment}>{environment}</span>
      </header>
      <div className={styles.adminLayout}>
        <aside className={styles.sidebar} aria-label="관리자 메뉴">
          <nav>
            <Link href={"/admin" as Route}>개요</Link>
            <Link className={styles.activeNav} href={"/admin/celebrities" as Route} aria-current="page">셀럽 콘텐츠</Link>
            <span aria-disabled="true">라이브</span>
            <span aria-disabled="true">혜택</span>
            <span aria-disabled="true">블록체인 작업</span>
            <span aria-disabled="true">감사 로그</span>
          </nav>
        </aside>

        <main className={styles.workspace} id="main-content">
          <div className={styles.workspaceHeading}>
            <div><p className={styles.breadcrumb}>콘텐츠 관리</p><h1>셀럽</h1><p>한국어와 영어 프로필을 준비하고 팬 화면 공개 상태를 관리합니다.</p></div>
            <button type="button" disabled={disabled}><Plus aria-hidden="true" /> 새 셀럽 등록</button>
          </div>

          {disabled && (
            <div className={styles.integrationNotice} role="status">
              <AlertCircle aria-hidden="true" />
              <div><strong>관리자 서버 연결 전</strong><p>현재는 화면 구조만 확인할 수 있습니다. 인증된 CMS API가 연결되기 전까지 조회·저장·발행은 실행되지 않습니다.</p></div>
            </div>
          )}

          <div className={styles.managerLayout}>
            <section className={styles.listPane} aria-labelledby="celebrity-list-heading">
              <div className={styles.paneHeading}><h2 id="celebrity-list-heading">등록된 셀럽</h2><span>0명</span></div>
              <label className={styles.searchField}><span className={styles.srOnly}>셀럽 검색</span><Search aria-hidden="true" /><input type="search" placeholder="이름으로 검색" disabled={disabled} /></label>
              <div className={styles.emptyState}><p>표시할 수 있는 셀럽 데이터가 없습니다.</p><span>권한 확인과 CMS 조회가 완료되면 목록이 표시됩니다.</span></div>
            </section>

            <section className={styles.editorPane} aria-labelledby="editor-heading">
              <div className={styles.paneHeading}><div><h2 id="editor-heading">새 셀럽 정보</h2><p>필수 콘텐츠를 모두 입력해야 발행할 수 있습니다.</p></div><span className={styles.draftBadge}>초안</span></div>
              <form className={styles.editorForm} aria-label="셀럽 콘텐츠 편집">
                <fieldset disabled={disabled}>
                  <legend>기본 정보</legend>
                  <div className={styles.fieldGrid}>
                    <label><span>셀럽 이름 (한국어)</span><input name="nameKo" required autoComplete="off" /></label>
                    <label><span>Celebrity name (English)</span><input name="nameEn" required autoComplete="off" lang="en" /></label>
                  </div>
                  <label><span>공개 URL</span><div className={styles.slugField}><span>byus.kr/celebrities/</span><input name="slug" required aria-label="공개 URL 슬러그" /></div></label>
                </fieldset>

                <fieldset disabled={disabled}>
                  <legend>프로필 이미지</legend>
                  <label className={styles.imageDrop}><ImagePlus aria-hidden="true" /><strong>프로필 이미지 선택</strong><span>세로형 4:5, JPG·PNG·WebP</span><input className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="프로필 이미지" required /></label>
                </fieldset>

                <p className={styles.publishRule}><AlertCircle aria-hidden="true" /> 한국어와 영어 콘텐츠, 프로필 이미지가 모두 있어야 발행할 수 있습니다.</p>
                <div className={styles.formActions}><button className={styles.secondaryButton} type="button" disabled={disabled}>초안 저장</button><button className={styles.primaryButton} type="submit" disabled={disabled}>발행하기</button></div>
              </form>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
