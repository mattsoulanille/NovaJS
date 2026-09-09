import * as t from 'io-ts';

/**
 * The shared identity of a wire snapshot's component list: `[name,
 * data, encoding][]`, the third element saying which of the component's
 * two codecs captured the data ('serializer' = the world's serializer
 * codec, 'wire' = an explicit wire codec from the snapshot policies).
 *
 * One shared codec instance (rather than an inline `t.array(t.tuple)`
 * at each use) so nova's wire-schema reflection can recognise it by
 * identity and type each pair's data with the component's own codec —
 * the same trick nova_ecs's EncodedComponentList uses for the ECS
 * component list. The trailing tag is DROPPED on the binary wire (see
 * io_ts_to_avro's componentList): which codec captured the data is a
 * property of the sending world's snapshot policies, and the receiving
 * world decodes through its own.
 */
export const WireComponentTupleType = t.tuple([
    t.string, t.unknown, t.union([t.literal('serializer'), t.literal('wire')]),
]);

export const WireComponentListType = t.array(WireComponentTupleType);
export type WireComponentListType = t.TypeOf<typeof WireComponentListType>;

/** The item tuple's arity, for the derivation's componentUnion. */
export const WIRE_COMPONENT_TUPLE_ARITY = 3 as const;
