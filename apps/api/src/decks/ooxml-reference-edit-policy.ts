import { isDeepStrictEqual } from "node:util";

import type {
  Deck,
  DeckElement,
  DeckPatchOperation,
  OoxmlTemplateSlotMutation,
  TemplateBlueprint,
} from "@orbit/shared";

export type ReferenceEditPolicyViolation = {
  operation: string;
  reason: string;
  elementId?: string;
  slideId?: string;
};

type SlotPolicy = TemplateBlueprint["slotEditPolicies"][number];

export function findReferencePatchViolation(
  deck: Deck,
  blueprint: TemplateBlueprint | undefined,
  operations: readonly DeckPatchOperation[],
): ReferenceEditPolicyViolation | null {
  if (!deck.metadata.ooxmlReferenceTemplateSnapshot) return null;
  const policyState = referencePolicyState(deck, blueprint);
  if (!policyState.ok) return policyState.violation;

  for (const operation of operations) {
    if (operation.type !== "update_element_props") {
      return {
        operation: operation.type,
        reason: "reference-template Decks only allow slot content mutations",
        ...operationTarget(operation),
      };
    }
    const target = findDeckElement(deck, operation.slideId, operation.elementId);
    const policy = policyState.policies.get(
      `${operation.slideId}\0${operation.elementId}`,
    );
    if (!target || !policy) {
      return {
        operation: operation.type,
        reason: "element is not an editable reference-template slot",
        slideId: operation.slideId,
        elementId: operation.elementId,
      };
    }
    const reason = invalidSlotPropsReason(
      target,
      policy.mutationPolicy[0],
      operation.props,
    );
    if (reason) {
      return {
        operation: operation.type,
        reason,
        slideId: operation.slideId,
        elementId: operation.elementId,
      };
    }
  }
  return null;
}

export function findReferenceReplacementViolation(
  currentDeck: Deck,
  requestedDeck: Deck,
  blueprint: TemplateBlueprint | undefined,
): ReferenceEditPolicyViolation | null {
  if (!currentDeck.metadata.ooxmlReferenceTemplateSnapshot) return null;
  const policyState = referencePolicyState(currentDeck, blueprint);
  if (!policyState.ok) return policyState.violation;

  const expected = structuredClone(currentDeck);
  expected.version = requestedDeck.version;
  for (const [key, policy] of policyState.policies) {
    const separator = key.indexOf("\0");
    const slideId = key.slice(0, separator);
    const elementId = key.slice(separator + 1);
    const current = findDeckElement(currentDeck, slideId, elementId);
    const requested = findDeckElement(requestedDeck, slideId, elementId);
    if (!current || !requested || current.type !== requested.type) {
      return {
        operation: "put_deck",
        reason: "reference-template slot identity changed",
        slideId,
        elementId,
      };
    }
    if (!isDeepStrictEqual(current.props, requested.props)) {
      const changedProps = changedPropsRecord(current.props, requested.props);
      const reason = invalidSlotPropsReason(
        current,
        policy.mutationPolicy[0],
        changedProps,
      );
      if (reason) {
        return {
          operation: "put_deck",
          reason,
          slideId,
          elementId,
        };
      }
      const expectedElement = findDeckElement(expected, slideId, elementId);
      if (expectedElement) expectedElement.props = structuredClone(requested.props);
    }
  }

  if (!isDeepStrictEqual(expected, requestedDeck)) {
    return {
      operation: "put_deck",
      reason: "replacement changed locked reference-template state",
    };
  }
  return null;
}

function referencePolicyState(
  deck: Deck,
  blueprint: TemplateBlueprint | undefined,
):
  | { ok: true; policies: Map<string, SlotPolicy> }
  | { ok: false; violation: ReferenceEditPolicyViolation } {
  const deckSnapshot = deck.metadata.ooxmlReferenceTemplateSnapshot;
  const blueprintSnapshot = blueprint?.referenceTemplateSnapshot;
  if (
    !deckSnapshot ||
    !blueprint ||
    !blueprintSnapshot ||
    deckSnapshot.catalogTemplateId !== blueprintSnapshot.catalogTemplateId ||
    deckSnapshot.catalogTemplateVersion !== blueprintSnapshot.catalogTemplateVersion ||
    deckSnapshot.sourceSha256 !== blueprintSnapshot.sourceSha256
  ) {
    return {
      ok: false,
      violation: {
        operation: "policy_resolution",
        reason: "reference-template slot policy is missing or does not match the Deck snapshot",
      },
    };
  }

  const slideIdByElementId = new Map<string, string>();
  for (const slide of blueprint.slides) {
    if (!slide.slideId) continue;
    for (const source of slide.elementSources) {
      slideIdByElementId.set(source.elementId, slide.slideId);
    }
  }
  const policies = new Map<string, SlotPolicy>();
  for (const policy of blueprint.slotEditPolicies) {
    const slideId = slideIdByElementId.get(policy.elementId);
    if (!slideId || policy.frameLocked !== true) {
      return {
        ok: false,
        violation: {
          operation: "policy_resolution",
          reason: "reference-template slot policy has no stable slide mapping",
          elementId: policy.elementId,
        },
      };
    }
    policies.set(`${slideId}\0${policy.elementId}`, policy);
  }
  return { ok: true, policies };
}

function invalidSlotPropsReason(
  element: DeckElement,
  mutation: OoxmlTemplateSlotMutation | undefined,
  props: Record<string, unknown>,
): string | null {
  if (!mutation) return "slot mutation policy is missing";
  const propNames = Object.keys(props);
  if (propNames.length === 0) return "slot props patch is empty";

  if (mutation === "text-content" && element.type === "text") {
    if (!onlyKeys(propNames, ["text", "runs", "paragraphs"])) {
      return "text slots only allow text content props";
    }
    if (
      ("runs" in props && !sameNonTextStructure(element.props.runs, props.runs)) ||
      ("paragraphs" in props &&
        !sameNonTextStructure(element.props.paragraphs, props.paragraphs))
    ) {
      return "text slot rich-text structure or style changed";
    }
    return null;
  }
  if (mutation === "image-source" && element.type === "image") {
    if (!onlyKeys(propNames, ["src", "alt"])) {
      return "image slots only allow src and alt props";
    }
    if (
      "alt" in props &&
      (typeof props.alt !== "string" ||
        props.alt.length > 500 ||
        !isXml10Text(props.alt))
    ) {
      return "image slot alt text is not XML-safe";
    }
    return null;
  }
  if (mutation === "table-cell-text" && element.type === "table") {
    if (!onlyKeys(propNames, ["rows"])) {
      return "table slots only allow cell content props";
    }
    return sameNonTextStructure(element.props.rows, props.rows)
      ? null
      : "table slot shape or cell style changed";
  }
  if (mutation === "chart-data" && element.type === "chart") {
    return onlyKeys(propNames, ["data"])
      ? null
      : "chart slots only allow data props";
  }
  return "slot mutation policy does not match the target element type";
}

function sameNonTextStructure(current: unknown, next: unknown): boolean {
  return isDeepStrictEqual(stripTextValues(current), stripTextValues(next));
}

function isXml10Text(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      !(
        codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      )
    ) {
      return false;
    }
  }
  return true;
}

function stripTextValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTextValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "text" ? "__OOXML_REFERENCE_TEXT__" : stripTextValues(nested),
    ]),
  );
}

function onlyKeys(actual: readonly string[], allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return actual.every((key) => allowedSet.has(key));
}

function findDeckElement(deck: Deck, slideId: string, elementId: string) {
  return deck.slides
    .find((slide) => slide.slideId === slideId)
    ?.elements.find((element) => element.elementId === elementId);
}

function changedPropsRecord(
  currentProps: DeckElement["props"],
  nextProps: DeckElement["props"],
): Record<string, unknown> {
  const current = currentProps as Record<string, unknown>;
  const next = nextProps as Record<string, unknown>;
  return Object.fromEntries(
    [...new Set([...Object.keys(current), ...Object.keys(next)])]
      .filter((key) => !isDeepStrictEqual(current[key], next[key]))
      .map((key) => [key, key in next ? next[key] : null]),
  );
}

function operationTarget(operation: DeckPatchOperation) {
  const slideId = "slideId" in operation ? operation.slideId : undefined;
  const elementId = "elementId" in operation ? operation.elementId : undefined;
  return { ...(slideId ? { slideId } : {}), ...(elementId ? { elementId } : {}) };
}
