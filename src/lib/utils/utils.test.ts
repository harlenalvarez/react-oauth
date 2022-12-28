import { describe, expect, it } from 'vitest';
import { b64Decode, b64Encode, create, genKey, isRequired } from './index';

class User {
    name!: string
    age?:number
}

type UserType = {
    name: string
    age?: number
}

class RequiredTest {
    name: string
    constructor(obj: Partial<RequiredTest>) {
        Object.assign(this, obj);
        this.name = obj.name || isRequired('name')
    }
}

describe('Utils tests', () => {
    it('Should create intance of class from object', () => {
        const user = {
            name: 'bob'
        }
        const userIntance = create<User>(user, User);
        expect(userIntance).toBeInstanceOf(User);
        expect(userIntance).toEqual(expect.objectContaining({ name: 'bob', age: undefined }));
    });

    it('Should create intance from another intance', () => {
        const user = create({name: 'bob'}, User);
        expect(user).toBeInstanceOf(User);
        const copy = create(user);
        expect(copy).not.toBe(user);
        expect(copy).toBeInstanceOf(User);
        expect(copy).toMatchObject({ name: 'bob', age: undefined });
    });

    it('Should create instance from type', () => {
        let user: UserType = {
            name: 'bob'
        }

        const userInstance = create(user);
        expect(userInstance).toMatchObject({ name: 'bob' });
    });

    it('Should throw error for required fields', () => {
        const valid = new RequiredTest({ name: 'bob'});
        expect(() => new RequiredTest({})).toThrowError();
    });

    it('Should encode to b64', () => {
        const payload = 'test';
        const encoded = b64Encode(payload);
        expect(encoded).toEqual('dGVzdA==');

        const specialPayload = 'testàáâäãåā';
        const specialEncode = b64Encode(specialPayload);
        expect(specialEncode).toEqual('dGVzdCVDMyVBMCVDMyVBMSVDMyVBMiVDMyVBNCVDMyVBMyVDMyVBNSVDNCU4MQ==')
    });

    it('Should decode from b64', ()=> {
        const result = b64Decode('dGVzdCVDMyVBMCVDMyVBMSVDMyVBMiVDMyVBNCVDMyVBMyVDMyVBNSVDNCU4MQ==')
        expect(result).toEqual('testàáâäãåā');
    });

    it('Should gen key', async () => {
        const key = await genKey();
        expect(key).not.toBeNull();
    })
});