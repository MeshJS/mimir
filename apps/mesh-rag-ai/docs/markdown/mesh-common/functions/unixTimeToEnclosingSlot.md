[**@meshsdk/common**](../README.md)

***

[@meshsdk/common](../globals.md) / unixTimeToEnclosingSlot

# Function: unixTimeToEnclosingSlot()

> **unixTimeToEnclosingSlot**(`unixTime`, `slotConfig`): `number`

Defined in: [data/time.ts:67](https://github.com/MeshJS/mesh/blob/1abde1553cbd7cf2cf4e40197fc0de9e4a7d0f49/packages/mesh-common/src/data/time.ts#L67)

Eqivalent to `slotToBeginUnixTime` but option to provide optional config

## Parameters

### unixTime

`number`

Timestamp in milliseconds

### slotConfig

[`SlotConfig`](../type-aliases/SlotConfig.md)

Slot configuration for calculation

## Returns

`number`

Slot number
