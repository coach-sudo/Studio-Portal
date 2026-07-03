import { describe,expect,it } from "vitest";
import { creditBalance,studentBalanceMinor } from "./finance";
describe("immutable ledgers",()=>{
  it("derives package credits from entries",()=>{expect(creditBalance("p",[{id:"1",packageId:"p",kind:"purchase",quantity:10,reason:"buy",createdAt:""},{id:"2",packageId:"p",kind:"consumption",quantity:-3,reason:"use",createdAt:""}])).toBe(7)});
  it("derives payment balance without mutating records",()=>{expect(studentBalanceMinor("s",[{id:"1",studentId:"s",kind:"adjustment",amountMinor:5000,currency:"USD",reason:"due",createdAt:""},{id:"2",studentId:"s",kind:"payment",amountMinor:2000,currency:"USD",reason:"paid",createdAt:""},{id:"3",studentId:"s",kind:"refund",amountMinor:500,currency:"USD",reason:"refund",createdAt:""}])).toBe(-6500)});
});
