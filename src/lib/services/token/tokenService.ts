//TODO: this service takes a token, parses it, and does some basic validation
// validate aud, iss and exp
// if we have crypto available validate the payload with the key
class TokenService {

}

const instance = new TokenService();
export {
  instance as TokenService
};
