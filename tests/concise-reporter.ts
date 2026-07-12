import { MinimalReporter } from "vite-plus/test/node";

export default class ConciseReporter extends MinimalReporter {
  private failedHeading = false;

  override onInit(ctx: Parameters<MinimalReporter["onInit"]>[0]) {
    this.ctx = ctx;
  }

  override onTestRunStart(specifications: Parameters<MinimalReporter["onTestRunStart"]>[0]) {
    this.failedHeading = false;
    super.onTestRunStart(specifications);
  }

  override onTestModuleEnd() {}

  override onTestCaseResult(test: Parameters<MinimalReporter["onTestCaseResult"]>[0]) {
    if (test.result().state === "failed") {
      if (!this.failedHeading) {
        this.error("Failed tests:");
        this.failedHeading = true;
      }
      this.error(`  ${test.module.relativeModuleId} > ${test.fullName}`);
    }
  }

  override reportSummary(
    files: Parameters<MinimalReporter["reportSummary"]>[0],
    errors: Parameters<MinimalReporter["reportSummary"]>[1],
  ) {
    this.reportTestSummary(files, errors, 0);
    if (this.failedHeading || errors.length) {
      this.log("For full failure details, run `vp run tests#test`.");
    }
  }
}
