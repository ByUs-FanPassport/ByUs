import{expect,it}from"vitest";import{actionRequiredSourceKey}from"./action-required-notification";
it("binds every action-required intent to entity and revision/window",()=>expect(actionRequiredSourceKey("recipient_information_required","winner-1",1)).toBe("recipient_information_required:winner-1:1"));
